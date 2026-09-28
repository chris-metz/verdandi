import type {
  Contract,
  CoreEventName,
  CoreEvents,
  Screen,
} from "./contract.ts";
import type { HostEnvironment } from "./directories.ts";
import { createEmitter } from "./emitter.ts";
import type { CommandRunner } from "./github/command-runner.ts";
import {
  readPools,
  type GitHubAccess,
  type GitHubRead,
  type GitHubResponse,
  type ReadValue,
} from "./github/port.ts";
import { createIssueLists, type IssueLists } from "./issue-lists.ts";
import { createIssuePages, type IssuePages } from "./issue-pages.ts";
import { createIssueStore } from "./issue-store.ts";
import { createClock } from "./moments.ts";
import { isTransient, problemOf } from "./problems.ts";
import { qualifiedReference, sameRepository } from "./repository-address.ts";
import {
  createRepositoryPicker,
  type RepositoryPicker,
} from "./repository-picker.ts";
import {
  createRequestQueue,
  interrupted,
  type SendRequest,
} from "./request-queue.ts";
import type { LocalStateStorage, SettingsStorage } from "./settings/port.ts";
import { createGhSetup } from "./setup.ts";
import { createSidebar, type Sidebar } from "./sidebar.ts";
import { createSidebarSelection } from "./sidebar-selection.ts";

/** At most this many `gh` processes run at once. */
const maxConcurrentRequests = 4;

/**
 * A request GitHub's servers failed is tried again this many times, after
 * waiting this long and then twice as long, before it fails.
 */
const transientRetries = 2;
const firstRetryDelay = 1000;

export interface CoreOptions {
  /** GitHub access through the gh executable at a path, once one is found. */
  github: (gh: string) => GitHubAccess;
  /** Runs the gh executables found or chosen, to check them. */
  runCommand: CommandRunner;
  /**
   * Where gh is looked for: the operating system, the environment's PATH and
   * the home directory.
   */
  host: HostEnvironment;
  settings: SettingsStorage;
  /** Machine-local state, kept apart from portable user data. */
  localState: LocalStateStorage;
  /** The time, in milliseconds since the epoch: the system clock by default. */
  now?: () => number;
  /**
   * Waits a number of milliseconds, e.g. before trying a request again, or
   * while a rate limit holds requests back: with a timer by default.
   */
  wait?: (milliseconds: number) => Promise<void>;
}

/**
 * What the core has read from GitHub as one account, and the sidebar's
 * counts, lists and issue pages built from it. When GitHub is read as another
 * account, it is dropped as a whole for a new one, so that nothing read as
 * one account ever shows for another.
 */
interface Session {
  /** The sidebar's counts. */
  sidebar: Sidebar;
  /** The lists, which share the session's issue store with the pages. */
  lists: IssueLists;
  /** The issue pages. */
  pages: IssuePages;
  /** The repository picker's suggestions, checks and additions. */
  picker: RepositoryPicker;
  /** Sends a request for the session, as long as it lasts. */
  request: SendRequest;
  /** Ends the session: it asks GitHub nothing more, and pushes nothing. */
  end(): void;
}

/** Creates the core, which implements the contract every interface uses. */
export function createCore({
  github,
  runCommand,
  host,
  settings,
  localState,
  now = Date.now,
  wait = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
}: CoreOptions): Contract & { dispose(): void } {
  const events = createEmitter<CoreEvents>();
  const clock = createClock(now);
  const queue = createRequestQueue({
    concurrency: maxConcurrentRequests,
    now,
    wait,
    push: (states) => {
      events.emit("rateLimitsChanged", states);
    },
    account: () => setup.accountTag(),
  });
  /** The screen the main area shows, as last opened, refreshed or shown. */
  let shown: Screen | undefined;
  /** Whether the repository picker is open, over the screen shown. */
  let pickerOpen = false;

  /**
   * Takes the screen the main area shows now. The requests of a screen left
   * that have not been sent are dropped; those under way finish into the
   * store.
   */
  function show(screen: Screen | undefined) {
    if (
      shown?.kind === "issue" &&
      (screen?.kind !== "issue" || screen.issueId !== shown.issueId)
    )
      session.pages.leave(shown.issueId);
    shown = screen;
    queue.sweep();
  }

  // While a pool that reads draw on is below a tenth of its budget, nothing
  // is read again only because it grew old.
  const mayRevalidate = () =>
    !Object.values(readPools).some((pool) => queue.isLow(pool));

  const setup = createGhSetup({
    runCommand,
    host,
    localState,
    github,
    push: (changed) => {
      events.emit("setupChanged", changed);
    },
    notify: (notice) => {
      events.emit("notice", notice);
    },
    now,
    // Back from the blocker, what is on screen is shown again at once, as
    // if it had been opened now: what failed meanwhile, or is older than five
    // minutes, is read again, and what waited is not asked for twice.
    recovered: () => {
      openShown();
      void session.sidebar.read();
    },
    // Everything read as the previous account is dropped, and what is on
    // screen read anew.
    accountChanged: (account, previous) => {
      queue.cancel();
      session.end();
      session = createSession();
      events.emit("notice", { kind: "account-changed", previous, account });
      openShown();
      if (pickerOpen) session.picker.open();
      void session.sidebar.reload();
    },
  });

  /** Opens the screen the main area shows, if any, as if it opened now. */
  function openShown() {
    if (shown?.kind === "list") session.lists.open(shown.scope);
    if (shown?.kind === "issue") session.pages.open(shown.issueId);
  }

  // Every request waits until gh is usable and signed in, and has what
  // becomes of it checked for signs that it is no longer. GitHub answering
  // it as another account than it was sent as changes the account, and the
  // request queue discards the answer. One that GitHub's servers failed is
  // tried again, a few times; any other failure waits to be retried, so that
  // failing to reach GitHub never loops.
  const request: SendRequest = async (read, args, urgency) => {
    for (let attempt = 0; ; attempt++) {
      const access = await setup.access();
      const result = await queue.run(readPools[read], urgency, async () => {
        const tag = setup.accountTag();
        const response = await send(
          access,
          read,
          typeof args === "function" ? args() : args,
        );
        if (response.viewerLogin !== undefined) {
          setup.answeredAs(response.viewerLogin, tag);
        }
        return response;
      });
      if (result.ok) return result;
      if (result.error.kind === "interrupted") return result;
      setup.requestFailed(result.error);
      if (!isTransient(result.error) || attempt === transientRetries) {
        return result;
      }
      await wait(firstRetryDelay * 2 ** attempt);
    }
  };

  /** Starts reading GitHub afresh, with nothing read yet. */
  function createSession(): Session {
    let live = true;
    // Once the session has ended, its requests are dropped unsent, and what
    // it would push is never pushed.
    const sessionRequest: SendRequest = (read, args, urgency) =>
      live
        ? request(read, args, () => (live ? urgency() : undefined))
        : Promise.resolve(interrupted);
    function emit<E extends CoreEventName>(event: E, payload: CoreEvents[E]) {
      if (live) events.emit(event, payload);
    }

    const sidebar = createSidebar({
      settings,
      request: sessionRequest,
      clock,
      mayRevalidate,
      push: (entries) => {
        emit("sidebarChanged", entries);
      },
    });
    const store = createIssueStore();
    const pages = createIssuePages({
      store,
      request: sessionRequest,
      settings,
      clock,
      shown: () => shown,
      mayRevalidate,
      relationshipsPaused: () =>
        queue
          .states()
          .some(
            ({ pool, status }) =>
              pool === readPools.fetchRelationships && status === "paused",
          ),
      push: (page) => {
        emit("issuePageChanged", page);
      },
    });
    const stopWatchingLimits = events.on("rateLimitsChanged", () => {
      pages.requestsChanged();
    });
    const lists = createIssueLists({
      store,
      request: sessionRequest,
      settings,
      clock,
      shown: () => shown,
      mayRevalidate,
      push: (list) => {
        emit("listChanged", list);
      },
      // The sidebar's count follows a repository's open issues each time
      // they have loaded, for its list or for All.
      openIssuesLoaded: (repository, openIssues, readAt) => {
        sidebar.openIssuesLoaded(repository, openIssues, readAt);
      },
    });
    const picker = createRepositoryPicker({
      settings,
      request: sessionRequest,
      clock,
      isOpen: () => pickerOpen,
      push: (suggestions) => {
        emit("repositorySuggestionsChanged", suggestions);
      },
    });
    return {
      sidebar,
      lists,
      pages,
      picker,
      request: sessionRequest,
      end() {
        live = false;
        stopWatchingLimits();
      },
    };
  }

  let session = createSession();
  const selection = createSidebarSelection(settings, localState);
  async function settingsChanged() {
    await session.lists.settingsChanged();
    await session.pages.settingsChanged();
    await session.sidebar.reload();
    session.picker.settingsChanged();
    queue.sweep();
  }
  const stopWatchingSettings = settings.watch(() => {
    void settingsChanged();
  });

  return {
    ...selection,
    async getWindowState() {
      return (await localState.read()).window;
    },
    saveWindowState(window) {
      return localState.update({ window });
    },
    dispose() {
      stopWatchingSettings();
      session.end();
      queue.cancel();
    },
    reloadSettings() {
      return settingsChanged();
    },
    async resetSettings() {
      const result = await settings.reset();
      await settingsChanged();
      return result;
    },
    openRepositoryPicker() {
      pickerOpen = true;
      session.picker.open();
      return Promise.resolve();
    },
    closeRepositoryPicker() {
      pickerOpen = false;
      queue.sweep();
      return Promise.resolve();
    },
    checkRepository(repository) {
      return session.picker.check(repository);
    },
    async addRepositories(repositories) {
      const additions = await session.picker.add(repositories);
      if (additions.some(({ status }) => status === "added")) {
        await settingsChanged();
      }
      return additions;
    },
    async removeRepository(repository) {
      const selected = await selection.getSelectedSidebarEntry();
      const { selectedEntry: storedSelection } = await localState.read();
      const { value } = await settings.read();
      // Restored selections expose their current address. For the keyboard
      // action, keep the stored identity even if that old name was reused.
      const id =
        repository.id ??
        (selected.kind === "repository" &&
        sameRepository(selected.repository, repository) &&
        storedSelection?.kind === "repository" &&
        "id" in storedSelection
          ? storedSelection.id
          : undefined);
      const index = value.repositories.findIndex((entry) =>
        id !== undefined ? entry.id === id : sameRepository(entry, repository),
      );
      const tracked = value.repositories[index];
      if (!tracked) return { ok: true, selection: selected };
      const result = await settings.removeRepository(tracked);
      if (!result.ok) return result;
      if (
        selected.kind === "repository" &&
        (storedSelection?.kind === "repository" && "id" in storedSelection
          ? storedSelection.id === tracked.id
          : sameRepository(selected.repository, tracked))
      ) {
        const neighbour =
          value.repositories[index + 1] ?? value.repositories[index - 1];
        await selection.selectSidebarEntry(
          neighbour
            ? { kind: "repository", repository: neighbour }
            : { kind: "all" },
        );
      }
      await settingsChanged();
      return { ok: true, selection: await selection.getSelectedSidebarEntry() };
    },
    async skipRepositoryPicker() {
      const result = await settings.createIfMissing();
      await session.sidebar.reload();
      return result;
    },
    async reorderSidebar(entry, destination) {
      const result = await settings.reorder(entry, destination);
      await session.sidebar.reload();
      return result;
    },
    retryBlockingBranch(issueId, cardId, side) {
      session.pages.retryBlockingBranch(issueId, cardId, side);
      return Promise.resolve();
    },
    activateBlockingEnd(issueId, side) {
      session.pages.activateBlockingEnd(issueId, side);
      queue.sweep();
      return Promise.resolve();
    },
    openIssuePage(issueId) {
      show({ kind: "issue", issueId });
      session.pages.open(issueId);
      session.sidebar.revalidate();
      return Promise.resolve();
    },
    renewMediaLinks(issueId, bodyId) {
      return session.pages.renewMediaLinks(issueId, bodyId);
    },
    async lookUpIssue(repository, number) {
      // Asked for, it is as urgent as what is on screen.
      const answer = await session.request(
        "fetchIssueByNumber",
        [repository, number],
        () => "visible",
      );
      if (!answer.ok) {
        return { status: "failed", problem: problemOf(answer.error) };
      }
      const found = answer.value;
      if (found.kind === "pull-request") {
        return { status: "pull-request", url: found.url };
      }
      const { id, title } = found.issue;
      return {
        status: "found",
        issue: {
          id,
          reference: qualifiedReference(
            found.issue.repository,
            found.issue.number,
          ),
          title,
          url: found.url,
        },
      };
    },
    getSetup() {
      return Promise.resolve(setup.current());
    },
    checkSetupAgain() {
      return setup.checkAgain();
    },
    chooseGhExecutable(path) {
      return setup.choose(path);
    },
    getSidebar() {
      return session.sidebar.read();
    },
    openList(scope) {
      show({ kind: "list", scope });
      session.lists.open(scope);
      session.sidebar.revalidate();
      return Promise.resolve();
    },
    setExpanded(scope, issueId, expanded) {
      session.lists.setExpanded(scope, issueId, expanded);
      return Promise.resolve();
    },
    setAllExpanded(scope, expanded) {
      session.lists.setAllExpanded(scope, expanded);
      return Promise.resolve();
    },
    refresh(screen) {
      show(screen);
      const { lists, pages, sidebar } = session;
      if (screen?.kind === "list") lists.refresh(screen.scope);
      if (screen?.kind === "issue") pages.refresh(screen.issueId);
      sidebar.refresh();
      return Promise.resolve();
    },
    revalidate(screen) {
      show(screen);
      setup.revalidate();
      const { lists, pages, sidebar } = session;
      if (screen?.kind === "list") lists.revalidate(screen.scope);
      if (screen?.kind === "issue") pages.revalidate(screen.issueId);
      sidebar.revalidate();
      return Promise.resolve();
    },
    retry(screen) {
      show(screen);
      const { lists, pages, sidebar } = session;
      if (screen?.kind === "list") lists.retry(screen.scope);
      if (screen?.kind === "issue") pages.retry(screen.issueId);
      sidebar.retry();
      return Promise.resolve();
    },
    getRateLimits() {
      return Promise.resolve(queue.states());
    },
    on: events.on,
  };
}

/** Sends one read through GitHub access. */
function send<R extends GitHubRead>(
  access: GitHubAccess,
  read: R,
  args: Parameters<GitHubAccess[R]>,
): Promise<GitHubResponse<ReadValue<R>>> {
  const method = access[read] as (
    ...args: Parameters<GitHubAccess[R]>
  ) => Promise<GitHubResponse<ReadValue<R>>>;
  return method.apply(access, args);
}
