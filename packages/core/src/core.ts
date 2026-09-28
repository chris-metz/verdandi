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
import { isTransient } from "./problems.ts";
import {
  createRequestQueue,
  interrupted,
  type SendRequest,
} from "./request-queue.ts";
import type { LocalStateStorage, SettingsStorage } from "./settings/port.ts";
import { createGhSetup } from "./setup.ts";
import { createSidebar, type Sidebar } from "./sidebar.ts";

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
  /** Machine-local state, which keeps the gh the user chose. */
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
}: CoreOptions): Contract {
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

  /**
   * Takes the screen the main area shows now. The requests of a screen left
   * that have not been sent are dropped; those under way finish into the
   * store.
   */
  function show(screen: Screen | undefined) {
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
      session.sidebar.reload();
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
        const response = await send(access, read, args);
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
      push: (page) => {
        emit("issuePageChanged", page);
      },
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
    return {
      sidebar,
      lists,
      pages,
      end() {
        live = false;
      },
    };
  }

  let session = createSession();

  return {
    openIssuePage(issueId) {
      show({ kind: "issue", issueId });
      session.pages.open(issueId);
      session.sidebar.revalidate();
      return Promise.resolve();
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
