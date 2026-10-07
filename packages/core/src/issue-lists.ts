import type {
  IssueList,
  IssueNode,
  IssueState,
  Label,
  ListLoading,
  ListProgress,
  LoadingState,
  Problem,
  RepositoryAddress,
  RepositoryEntry,
  RepositoryLoading,
  Scope,
  Screen,
  UnreadIssue,
} from "./contract.ts";
import { buildForest, type Forest } from "./forest.ts";
import type { IssueReference } from "./github/port.ts";
import {
  createIssueLoader,
  issueStates,
  type RepositoryIssues,
} from "./issue-loader.ts";
import type { Failure, IssueStore } from "./issue-store.ts";
import { carriesEvery } from "./label-filter.ts";
import {
  atOrAfter,
  fiveMinutesAgo,
  isOutdated,
  type Clock,
  type Moment,
} from "./moments.ts";
import {
  distinctRepositories,
  repositoryKey,
  sameRepository,
} from "./repository-address.ts";
import {
  mostUrgent,
  screenUrgency,
  type ScreenPart,
  type SendRequest,
  type Urgency,
} from "./request-queue.ts";
import type { SettingsStorage } from "./settings/port.ts";

/**
 * The lists of the main area, one per scope and state, over the one issue
 * store. Each scope shows its list in one state, open unless switched, for
 * the session; only that list is pushed. A list loads when it is first
 * opened and is then kept for the session, together with its expansion, and
 * read again when it is refreshed or has grown old. What of it failed is read
 * again when it is retried, opened again or shown again. The issue loader
 * reads a repository's issues in a state for its own list or for All,
 * whichever needs them, and they serve both. Only the list on screen asks
 * GitHub for anything: what it shows first, then what it would show below
 * collapsed issues, and, when it has grown old, all of it in the background.
 * A list left before it has loaded keeps what it has, marked interrupted
 * where it lacks something, until it shows again. Each scope has a label
 * filter for the session, which narrows its list in either state to what
 * has been read.
 */
export interface IssueLists {
  /** Updates lists when the startup count query learns repository availability. */
  repositoriesChanged(): void;
  /** Applies hand-edited tracking to cached lists, loading only the shown one. */
  settingsChanged(): Promise<void>;
  /**
   * Keeps a repository's lists, what was read of its issues, their
   * expansion, its state and its label filter, under its new address, as it
   * was renamed or transferred.
   */
  renameRepository(from: RepositoryAddress, to: RepositoryAddress): void;
  /**
   * Pushes a scope's list in its state at once. If it has not loaded, loads
   * it, pushing the list after each response; if it is older than five
   * minutes, reads it again the same way while it shows what it has;
   * otherwise reads again what of it failed.
   */
  open(scope: Scope): void;
  /** Shows a scope's list in a state from now on, and opens it. */
  switchState(scope: Scope, state: IssueState): void;
  /**
   * Reads everything a scope's list shows again now: its repositories'
   * issues in its state, and the other issues it shows, with the sub-issues
   * of expanded ones. What it has shows meanwhile.
   */
  refresh(scope: Scope): void;
  /**
   * Reads an opened list again if it is older than five minutes, unless the
   * rate-limit budget is low, and otherwise what of it failed.
   */
  revalidate(scope: Scope): void;
  /**
   * Reads again what of an opened list failed, GitHub would not show, or
   * left out, however recently.
   */
  retry(scope: Scope): void;
  /** Expands or collapses one issue in an opened list, and pushes it. */
  setExpanded(scope: Scope, issueId: string, expanded: boolean): void;
  /** Expands or collapses every issue in an opened list, and pushes it. */
  setAllExpanded(scope: Scope, expanded: boolean): void;
  /**
   * Changes a scope's label filter, e.g. adding a label to it, and pushes its
   * list if it has been opened.
   */
  changeLabelFilter(
    scope: Scope,
    apply: (labelFilter: Label[]) => Label[],
  ): void;
}

export interface IssueListsOptions {
  repositoryStatus: (
    repository: RepositoryAddress,
  ) => Pick<RepositoryEntry, "unavailable" | "archived">;
  /** Takes why reading a repository's open or closed issues failed. */
  issuesFailed: (
    repository: RepositoryAddress,
    problem: Problem,
    readAt: Moment,
  ) => void;
  store: IssueStore;
  request: SendRequest;
  clock: Clock;
  /** The screen the main area shows, if any. */
  shown: () => Screen | undefined;
  /**
   * Whether what is outdated may be read again on its own, which it may not
   * while the rate-limit budget is low.
   */
  mayRevalidate: () => boolean;
  /**
   * Where the tracked repositories are listed: the ones All merges, and the
   * ones whose issues are not external.
   */
  settings: SettingsStorage;
  /** Pushes a list's current state to the interfaces. */
  push: (list: IssueList) => void;
  /**
   * Takes a repository's open-issue count once all its open issues loaded,
   * with when the read started.
   */
  openIssuesLoaded: (
    repository: RepositoryAddress,
    openIssues: number,
    readAt: Moment,
  ) => void;
}

/**
 * What a list reads beyond its repositories' issues in its state, how far
 * that has loaded, and what is expanded.
 */
interface ListState {
  /** The scope, as last opened. */
  scope: Scope;
  /** Which of the scope's issues it matches. */
  state: IssueState;
  /** The tracked repositories, once they have been read. */
  tracked: RepositoryAddress[] | undefined;
  /** Whether the tracked repositories are being read. */
  readingTracked: boolean;
  /** Why All could not read the tracked repositories, if it could not. */
  settingsProblem: Problem | undefined;
  /**
   * What the list shows must have been read from GitHub at this moment or
   * later; anything older is read again as it shows.
   */
  validFrom: Moment;
  /** When it was last opened or refreshed, in milliseconds since the epoch. */
  checkedAt: number;
  /**
   * Issues asked for by ID since `validFrom`, so none is asked for twice
   * unless it is retried.
   */
  requested: Set<string>;
  /** Reads of issues by ID the list waits for. */
  pendingRequests: number;
  expansion: Expansion;
  /** Whether it has shown what it read at some point. */
  loaded: boolean;
  /**
   * Whether it is read again on its own, because it grew old, rather than
   * because it was asked for: from then until it is refreshed, retried or
   * expanded or collapsed.
   */
  background: boolean;
}

/**
 * Which issues are expanded: all but the exceptions, or none but the
 * exceptions.
 */
interface Expansion {
  expanded: boolean;
  except: Set<string>;
}

export function createIssueLists({
  store,
  request,
  clock,
  shown,
  mayRevalidate,
  settings,
  push,
  openIssuesLoaded,
  issuesFailed,
  repositoryStatus,
}: IssueListsOptions): IssueLists {
  /** The lists, by `listKey`. */
  const lists = new Map<string, ListState>();
  /** The state each scope shows its list in, by `scopeKey`, unless open. */
  const states = new Map<string, IssueState>();
  /** Each scope's label filter, by `scopeKey`, unless it has none. */
  const labelFilters = new Map<string, Label[]>();
  const loader = createIssueLoader({
    store,
    request,
    clock,
    pagesUrgency: (repository, state) =>
      mostUrgent(
        [...lists.values()]
          .filter((list) => shows(list, repository, state))
          .map((list) => urgencyOf(list, "visible")),
      ),
    // Every list that shows the repository's issues follows their pages.
    pageRead: (repository, state) => {
      for (const list of lists.values()) {
        if (shows(list, repository, state) && list.tracked !== undefined) {
          update(list);
        }
      }
    },
    openIssuesLoaded,
    issuesFailed,
  });

  /** The state a scope shows its list in. */
  function stateOf(scope: Scope): IssueState {
    return states.get(scopeKey(scope)) ?? "open";
  }

  /** A scope's label filter, empty without one. */
  function labelFilterOf(scope: Scope): Label[] {
    return labelFilters.get(scopeKey(scope)) ?? [];
  }

  /**
   * A repository's issues in a state. Confirmed unavailability overrides
   * cached pages until access recovers.
   */
  function issuesOf(
    repository: RepositoryAddress,
    state: IssueState,
  ): RepositoryIssues | undefined {
    const unavailable = repositoryStatus(repository).unavailable;
    return unavailable
      ? {
          issueIds: new Set(),
          closedIssueCount: 0,
          readAt: undefined,
          reading: loader.issuesOf(repository, state)?.reading ?? false,
          problem: unavailable,
        }
      : loader.issuesOf(repository, state);
  }

  /** Whether a list shows a repository's issues in a state. */
  function shows(
    list: ListState,
    repository: RepositoryAddress,
    state: IssueState,
  ): boolean {
    return (
      list.state === state &&
      repositoriesOf(list).some((own) => sameRepository(own, repository))
    );
  }

  /** Whether a list is its scope's in its state, which alone is pushed. */
  function isCurrent(list: ListState): boolean {
    return (
      lists.get(listKey(list.scope, list.state)) === list &&
      stateOf(list.scope) === list.state
    );
  }

  /** Whether a list is the screen the main area shows. */
  function isShown(list: ListState): boolean {
    const screen = shown();
    return (
      screen?.kind === "list" &&
      scopeKey(screen.scope) === scopeKey(list.scope) &&
      isCurrent(list)
    );
  }

  /** How urgently a list needs a part of what it asks for. */
  function urgencyOf(list: ListState, part: ScreenPart): Urgency | undefined {
    return screenUrgency(
      { shown: isShown(list), background: list.background },
      part,
    );
  }

  /**
   * The repositories whose issues in its state a list shows, each once: its
   * own, or in All every tracked one.
   */
  function repositoriesOf(list: ListState): RepositoryAddress[] {
    if (list.scope.kind === "repository") return [list.scope.repository];
    return distinctRepositories(list.tracked ?? []);
  }

  /**
   * Why reading an issue the list asked for failed since the list needed it,
   * if it did.
   */
  function failureOf(list: ListState, id: string): Failure | undefined {
    const failure = store.failure(id);
    return list.requested.has(id) &&
      failure &&
      atOrAfter(failure.at, list.validFrom)
      ? failure
      : undefined;
  }

  /**
   * Why the list shows an issue it names only as a relationship names it:
   * reading it failed, or, for a match, which comes with its repository's
   * pages, reading those did.
   */
  function unreadIssue(list: ListState, issue: IssueReference): UnreadIssue {
    const unavailable = repositoryStatus(issue.repository).unavailable;
    if (unavailable) return { status: "failed", problem: unavailable };
    if (loader.isReading(issue.id)) return { status: "loading" };
    const failure = failureOf(list, issue.id);
    if (failure) return { status: "failed", problem: failure.problem };
    const pageProblem = comesWithPages(list, issue)
      ? issuesOf(issue.repository, list.state)?.problem
      : undefined;
    return pageProblem
      ? { status: "failed", problem: pageProblem }
      : { status: "loading" };
  }

  /**
   * Whether an issue arrives with the pages of the list's repositories: it
   * is theirs, and in the list's state.
   */
  function comesWithPages(list: ListState, issue: IssueReference): boolean {
    return (
      issue.state === list.state &&
      repositoriesOf(list).some((own) => sameRepository(own, issue.repository))
    );
  }

  /** The list's forest, as the store has it now. */
  function forestOf(list: ListState, tracked: RepositoryAddress[]): Forest {
    const trackedKeys = new Set(tracked.map(repositoryKey));
    const { expanded, except } = list.expansion;
    return buildForest({
      scope: list.scope,
      state: list.state,
      scopeIds: repositoriesOf(list).flatMap((repository) => [
        ...(issuesOf(repository, list.state)?.issueIds ?? []),
      ]),
      labelFilter: labelFilterOf(list.scope),
      lookup: (id) => {
        const issue = store.get(id);
        return issue && !repositoryStatus(issue.repository).unavailable
          ? issue
          : undefined;
      },
      unread: (issue) => unreadIssue(list, issue),
      isTracked: (address) => trackedKeys.has(repositoryKey(address)),
      isExpanded: (id) => (except.has(id) ? !expanded : expanded),
    });
  }

  /**
   * Arranges the list's forest from the store, and, while it is on screen,
   * asks for the issues it names but has not read, and for those it shows
   * that are older than it needs them: first what shows, then what would
   * show below collapsed issues.
   */
  function arrange(list: ListState): IssueList {
    const { scope, state, tracked } = list;
    // Until the tracked repositories are known, external issues cannot be
    // told apart, nor All's repositories named.
    if (tracked === undefined) {
      return {
        scope,
        state,
        labelFilter: labelFilterOf(scope),
        trees: [],
        loading: { status: "loading" },
        repositories: [],
      };
    }
    const own = repositoriesOf(list);
    const forest = forestOf(list, tracked);
    const outdated = shownIssues(forest.trees).flatMap((id) => {
      const readAt = store.readAt(id);
      const issue = store.get(id);
      return issue && readAt && !atOrAfter(readAt, list.validFrom)
        ? [issue]
        : [];
    });
    // A match arrives with its repository's page, also as a page that
    // failed is read again, unless it changed while the pages were read.
    const unread = [...forest.missing, ...outdated].filter((reference) => {
      if (repositoryStatus(reference.repository).unavailable) return false;
      if (!comesWithPages(list, reference)) return true;
      const load = issuesOf(reference.repository, state);
      return load?.reading === false && load.problem === undefined;
    });
    if (isShown(list)) {
      const hidden = (reference: IssueReference) =>
        forest.belowCollapsed.has(reference.id);
      readMissing(
        list,
        unread.filter((reference) => !hidden(reference)),
        "visible",
      );
      readMissing(list, unread.filter(hidden), "rest");
    }
    return {
      scope,
      state,
      labelFilter: labelFilterOf(scope),
      ...(scope.kind === "repository" &&
      repositoryStatus(scope.repository).archived
        ? { archived: true as const }
        : {}),
      trees: forest.trees,
      loading: loadingOf(list, forest),
      repositories:
        scope.kind === "all"
          ? own.map((repository): RepositoryLoading => ({
              repository,
              loading: repositoryLoading(issuesOf(repository, state)),
            }))
          : [],
    };
  }

  /** Pushes a list as it is now, if it is its scope's in its state. */
  function update(list: ListState) {
    if (!isCurrent(list)) return;
    push(arrange(list));
  }

  /**
   * Reads the issues a list names but has not asked for since it needs them
   * newer, together with any other list that asks for them, as urgently as
   * the part of the list they belong to.
   */
  function readMissing(
    list: ListState,
    missing: Pick<IssueReference, "id">[],
    part: ScreenPart,
  ) {
    const ids = [
      ...new Set(
        missing.map(({ id }) => id).filter((id) => !list.requested.has(id)),
      ),
    ];
    if (ids.length === 0) return;
    for (const id of ids) list.requested.add(id);
    let tracked = list.tracked;
    let needed: Set<string> | undefined;
    const urgency = (id: string) => {
      // Tracking can change while a batch waits. Keep only issues that
      // still belong to this forest, including its external relationships.
      if (tracked !== list.tracked) {
        tracked = list.tracked;
        const forest = forestOf(list, tracked ?? []);
        needed = new Set([
          ...readIssues(forest.trees),
          ...forest.missing.map((issue) => issue.id),
        ]);
      }
      return needed && !needed.has(id) ? undefined : urgencyOf(list, part);
    };
    for (const read of loader.readIssues(ids, list.validFrom, urgency)) {
      void awaitRead(list, read);
    }
  }

  /** Updates a list once a read of issues it waits for has settled. */
  async function awaitRead(list: ListState, read: Promise<void>) {
    const tracked = list.tracked;
    list.pendingRequests++;
    await read;
    list.pendingRequests--;
    if (tracked !== list.tracked) {
      // A remaining repository may reveal a relationship after removal
      // dropped its earlier read. Let the forest ask for it if needed again.
      for (const id of list.requested) {
        if (store.failure(id)?.problem.kind === "interrupted")
          list.requested.delete(id);
      }
    }
    update(list);
  }

  /**
   * Reads the tracked repositories, then starts reading the pages of the
   * list's repositories that are older than it needs.
   */
  async function start(list: ListState) {
    list.readingTracked = true;
    const read = await settings.read();
    if (lists.get(listKey(list.scope, list.state)) !== list) return;
    list.readingTracked = false;
    if (
      !read.ok &&
      read.value.repositories.length === 0 &&
      list.scope.kind === "all"
    ) {
      list.settingsProblem = { kind: "error", message: read.message };
    } else list.settingsProblem = undefined;
    list.tracked = read.value.repositories;
    const own = repositoriesOf(list);
    // A list whose repositories other lists have read shows what they read,
    // while it reads again what is older than it needs.
    if (own.every((repository) => issuesOf(repository, list.state)?.readAt)) {
      list.loaded = true;
    }
    // A repository that starts loading updates a list that has not loaded
    // with its first page; one that was read or is being read shows at once.
    let updateNow = list.loaded || list.settingsProblem !== undefined;
    for (const repository of own) {
      if (!loader.loadIssues(repository, list.state, list.validFrom)) {
        updateNow = true;
      }
    }
    if (updateNow) update(list);
  }

  /**
   * Reads everything a list shows again, from now on: in the background when
   * it is read again on its own.
   */
  function refresh(list: ListState, background = false) {
    list.background = background;
    list.validFrom = clock();
    list.checkedAt = list.validFrom.time;
    list.requested.clear();
    list.settingsProblem = undefined;
    // Its repositories' pages start at once, so that their issues in its
    // state are not also asked for by ID.
    for (const repository of repositoriesOf(list)) {
      loader.loadIssues(repository, list.state, list.validFrom);
    }
    void start(list);
    update(list);
  }

  /**
   * Reads again what of a list failed, GitHub would not show, or left out:
   * the tracked repositories, its repositories' issues, the issues it
   * asked for by ID, and the issues it shows that GitHub answered only in
   * part. Pushes the list, and says so, if anything is read again.
   */
  function retry(list: ListState): boolean {
    if (list.settingsProblem) {
      list.settingsProblem = undefined;
      void start(list);
      update(list);
      return true;
    }
    if (list.tracked === undefined) return false;
    let retried = false;
    for (const repository of repositoriesOf(list)) {
      if (issuesOf(repository, list.state)?.problem) {
        loader.loadIssues(
          repository,
          list.state,
          repositoryStatus(repository).unavailable ? clock() : list.validFrom,
        );
        retried = true;
      }
    }
    const again = new Set(
      [...list.requested].filter((id) => failureOf(list, id)),
    );
    // Also below collapsed issues, as the list counts them.
    for (const id of readIssues(forestOf(list, list.tracked).trees)) {
      if (store.get(id)?.incomplete) again.add(id);
    }
    for (const id of again) list.requested.delete(id);
    // Issues read in part are neither missing nor outdated, so they are
    // asked for here; the rest again as the list is arranged.
    readMissing(
      list,
      [...again].map((id) => ({ id })),
      "visible",
    );
    if (!retried && again.size === 0) return false;
    update(list);
    return true;
  }

  /** Starts a list, which takes what other lists read since `validFrom`. */
  function create(scope: Scope, state: IssueState, validFrom: Moment) {
    const list: ListState = {
      scope,
      state,
      tracked: undefined,
      readingTracked: false,
      settingsProblem: undefined,
      validFrom,
      checkedAt: clock().time,
      requested: new Set(),
      pendingRequests: 0,
      expansion: { expanded: true, except: new Set() },
      loaded: false,
      background: false,
    };
    lists.set(listKey(scope, state), list);
    update(list);
    void start(list);
  }

  /**
   * How far a list has loaded and how current it is, with its counts. It
   * failed when none of its repositories' issues in its state could be read,
   * and is stale when what it shows could not be read again. A repository
   * within All that failed does not count, and shows in `repositories`.
   */
  function loadingOf(list: ListState, forest: Forest): ListLoading {
    if (list.settingsProblem) {
      return { status: "failed", problem: list.settingsProblem };
    }
    const repositories = repositoriesOf(list);
    const loads = repositories.map((repository) =>
      issuesOf(repository, list.state),
    );
    const reading =
      list.readingTracked ||
      list.pendingRequests > 0 ||
      loads.some((load) => load?.reading !== false);
    // Read again after it failed with nothing to show, it is loading anew.
    const anyRead = loads.some((load) => load?.readAt !== undefined);
    if (reading && (!list.loaded || (loads.length > 0 && !anyRead))) {
      return list.state === "closed"
        ? { status: "loading", progress: closedProgress(repositories, loads) }
        : { status: "loading" };
    }
    const failures = loads.flatMap((load) =>
      load?.problem && !showsEarlierRead(load) ? [load.problem] : [],
    );
    const [firstFailure] = failures;
    if (firstFailure && failures.length === loads.length) {
      return { status: "failed", problem: firstFailure };
    }
    list.loaded = true;
    const labelFilter = labelFilterOf(list.scope);
    let matches = 0;
    let inScope = 0;
    let closedIssues = 0;
    let problem: Problem | undefined;
    // The list is as old as the oldest of what it shows.
    let updatedAt = Infinity;
    for (const load of loads) {
      if (!load || (!showsEarlierRead(load) && load.problem)) continue;
      inScope += load.issueIds.size;
      if (labelFilter.length === 0) matches += load.issueIds.size;
      else {
        for (const id of load.issueIds) {
          const labels = store.get(id)?.labels;
          if (labels && carriesEvery(labels, labelFilter)) matches++;
        }
      }
      closedIssues += load.closedIssueCount ?? 0;
      updatedAt = Math.min(updatedAt, load.readAt?.time ?? Infinity);
      problem ??= load.problem;
    }
    for (const id of shownIssues(forest.trees)) {
      const readAt = store.readAt(id);
      updatedAt = Math.min(updatedAt, readAt?.time ?? Infinity);
      // An issue whose reading again failed shows as it was read before.
      if (readAt && !atOrAfter(readAt, list.validFrom)) {
        problem ??= failureOf(list, id)?.problem;
      }
    }
    const loaded = {
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : list.checkedAt,
      matches,
      inScope,
      closedNotListed:
        list.state === "open" && labelFilter.length === 0
          ? Math.max(0, closedIssues - forest.closedShown)
          : 0,
    };
    if (reading) return { status: "refreshing", ...loaded };
    if (problem) return { status: "stale", problem, ...loaded };
    return { status: "current", ...loaded };
  }

  /**
   * How many closed issues a closed list has read of its repositories, and of
   * how many, as their closed pages count them, or before the first arrived,
   * their open pages.
   */
  function closedProgress(
    repositories: readonly RepositoryAddress[],
    loads: readonly (RepositoryIssues | undefined)[],
  ): ListProgress {
    let read = 0;
    let total: number | undefined = 0;
    for (const [index, repository] of repositories.entries()) {
      const load = loads[index];
      read += load?.issueIds.size ?? 0;
      const count =
        load?.closedIssueCount ??
        issuesOf(repository, "open")?.closedIssueCount;
      total =
        total === undefined || count === undefined ? undefined : total + count;
    }
    return { read, total };
  }

  /** A scope's list in its state, once opened. */
  function currentList(scope: Scope): ListState | undefined {
    return lists.get(listKey(scope, stateOf(scope)));
  }

  /** Updates a scope's list in its state after a change, if it is open. */
  function change(scope: Scope, apply: (list: ListState) => void) {
    const list = currentList(scope);
    if (!list) return;
    apply(list);
    update(list);
  }

  /** Pushes a scope's list in its state, loading it as it needs. */
  function open(scope: Scope) {
    const state = stateOf(scope);
    const known = lists.get(listKey(scope, state));
    if (!known) {
      // Opened for the first time, it takes what other lists have read in
      // the last five minutes.
      create(scope, state, fiveMinutesAgo(clock));
      return;
    }
    known.scope = scope;
    if (!revalidate(known)) update(known);
  }

  /**
   * Reads an opened list again in the background if it is older than five
   * minutes, unless the rate-limit budget is low, and otherwise what of it
   * failed, and says whether it pushed the list.
   */
  function revalidate(list: ListState): boolean {
    if (!isOutdated(arrange(list).loading, clock) || !mayRevalidate()) {
      return retry(list);
    }
    refresh(list, true);
    return true;
  }

  return {
    repositoriesChanged() {
      for (const list of lists.values()) update(list);
    },
    async settingsChanged() {
      const { value } = await settings.read();
      for (const [key, list] of lists) {
        const { scope } = list;
        if (
          scope.kind === "repository" &&
          !value.repositories.some((repository) =>
            sameRepository(repository, scope.repository),
          )
        ) {
          lists.delete(key);
          states.delete(scopeKey(scope));
          labelFilters.delete(scopeKey(scope));
          continue;
        }
        list.tracked = value.repositories;
        update(list);
        if (isShown(list)) void start(list);
      }
    },
    renameRepository(from, to) {
      loader.renameRepository(from, to);
      const old: Scope = { kind: "repository", repository: from };
      const scope: Scope = { kind: "repository", repository: { ...to } };
      moveScope(states, old, scope);
      moveScope(labelFilters, old, scope);
      for (const state of issueStates) {
        const list = lists.get(listKey(old, state));
        if (!list || lists.has(listKey(scope, state))) continue;
        lists.delete(listKey(old, state));
        list.scope = scope;
        lists.set(listKey(scope, state), list);
      }
    },
    open,
    switchState(scope, state) {
      if (state === "open") states.delete(scopeKey(scope));
      else states.set(scopeKey(scope), state);
      open(scope);
    },
    refresh(scope) {
      const state = stateOf(scope);
      const known = lists.get(listKey(scope, state));
      if (known) refresh(known);
      else create(scope, state, clock());
    },
    revalidate(scope) {
      const known = currentList(scope);
      if (known) revalidate(known);
    },
    retry(scope) {
      const known = currentList(scope);
      if (!known) return;
      // Asked for, what is read is no longer read in the background.
      known.background = false;
      retry(known);
    },
    setExpanded(scope, issueId, expanded) {
      change(scope, (list) => {
        const { expansion } = list;
        if (expanded === expansion.expanded) expansion.except.delete(issueId);
        else expansion.except.add(issueId);
        list.background = false;
      });
    },
    setAllExpanded(scope, expanded) {
      change(scope, (list) => {
        list.expansion = { expanded, except: new Set() };
        list.background = false;
      });
    },
    changeLabelFilter(scope, apply) {
      const labelFilter = apply(labelFilterOf(scope));
      if (labelFilter.length === 0) labelFilters.delete(scopeKey(scope));
      else labelFilters.set(scopeKey(scope), labelFilter);
      change(scope, (list) => {
        list.background = false;
      });
    },
  };
}

/**
 * Whether a repository's open issues show as an earlier read had them, since
 * the latest read failed in a way that keeps them, such as failing to reach
 * GitHub. Once GitHub would not show the repository, none show.
 */
function showsEarlierRead(load: RepositoryIssues): boolean {
  return load.readAt !== undefined && load.problem?.kind !== "unavailable";
}

/** How far a repository's open issues have loaded, and how current they are. */
function repositoryLoading(load: RepositoryIssues | undefined): LoadingState {
  if (load?.problem) {
    return load.readAt && showsEarlierRead(load)
      ? { status: "stale", updatedAt: load.readAt.time, problem: load.problem }
      : { status: "failed", problem: load.problem };
  }
  if (load?.readAt === undefined) return { status: "loading" };
  return {
    status: load.reading ? "refreshing" : "current",
    updatedAt: load.readAt.time,
  };
}

/**
 * The issues a forest shows as read: its trees, and below each the
 * sub-issues of the expanded ones.
 */
function shownIssues(trees: readonly IssueNode[]): string[] {
  return trees.flatMap((node) =>
    node.unread
      ? []
      : [node.issue.id, ...(node.expanded ? shownIssues(node.subIssues) : [])],
  );
}

/** Every issue of a forest that has been read, shown or collapsed away. */
function readIssues(trees: readonly IssueNode[]): string[] {
  return trees.flatMap((node) =>
    node.unread ? [] : [node.issue.id, ...readIssues(node.subIssues)],
  );
}

/** Tells scopes apart, whatever the case of a repository's name. */
function scopeKey(scope: Scope): string {
  return scope.kind === "all"
    ? "all"
    : `repository:${repositoryKey(scope.repository)}`;
}

/**
 * Keeps what a map holds for one scope under another, unless it holds
 * something for that one already.
 */
function moveScope<T>(byScope: Map<string, T>, from: Scope, to: Scope) {
  const kept = byScope.get(scopeKey(from));
  if (kept === undefined || byScope.has(scopeKey(to))) return;
  byScope.delete(scopeKey(from));
  byScope.set(scopeKey(to), kept);
}

/** Tells a scope's open and closed lists apart. */
function listKey(scope: Scope, state: IssueState): string {
  return `${state}:${scopeKey(scope)}`;
}
