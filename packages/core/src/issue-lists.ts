import type {
  IssueList,
  IssueNode,
  ListLoading,
  LoadingState,
  Problem,
  RepositoryAddress,
  RepositoryLoading,
  Scope,
  UnreadIssue,
} from "./contract.ts";
import { buildForest, type Forest } from "./forest.ts";
import type { IssueReference, SendRequest } from "./github/port.ts";
import { createIssueLoader, type RepositoryIssues } from "./issue-loader.ts";
import type { Failure, IssueStore } from "./issue-store.ts";
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
import type { SettingsStorage } from "./settings/port.ts";

/**
 * The lists of the main area, one per scope, over the one issue store. A list
 * loads when it is first opened and is then kept for the session, together
 * with its expansion, and read again when it is refreshed or has grown old.
 * What of it failed is read again when it is retried, opened again or shown
 * again. The issue loader reads a repository's open issues for its own list
 * or for All, whichever needs them, and they serve both.
 */
export interface IssueLists {
  /**
   * Pushes a scope's list at once. If it has not loaded, loads it, pushing
   * the list after each response; if it is older than five minutes, reads it
   * again the same way while it shows what it has; otherwise reads again
   * what of it failed.
   */
  open(scope: Scope): void;
  /**
   * Reads everything a scope's list shows again now: its repositories' open
   * issues, and the other issues it shows, with the sub-issues of expanded
   * ones. What it has shows meanwhile.
   */
  refresh(scope: Scope): void;
  /**
   * Reads an opened list again if it is older than five minutes, and
   * otherwise what of it failed.
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
}

export interface IssueListsOptions {
  store: IssueStore;
  request: SendRequest;
  clock: Clock;
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
 * What a list reads beyond its repositories' open issues, how far that has
 * loaded, and what is expanded.
 */
interface ListState {
  /** The scope, as last opened. */
  scope: Scope;
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
  settings,
  push,
  openIssuesLoaded,
}: IssueListsOptions): IssueLists {
  const lists = new Map<string, ListState>();
  const loader = createIssueLoader({
    store,
    request,
    clock,
    // Every list that shows the repository follows its pages.
    pageRead: (repository) => {
      for (const list of lists.values()) {
        const shows = repositoriesOf(list).some((own) =>
          sameRepository(own, repository),
        );
        if (shows && list.tracked !== undefined) update(list);
      }
    },
    openIssuesLoaded,
  });

  /**
   * The repositories whose open issues a list shows, each once: its own, or
   * in All every tracked one.
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
   * reading it failed, or, for an open issue of its repositories, which
   * comes with their pages, reading those did.
   */
  function unreadIssue(list: ListState, issue: IssueReference): UnreadIssue {
    if (loader.isReading(issue.id)) return { status: "loading" };
    const failure = failureOf(list, issue.id);
    if (failure) return { status: "failed", problem: failure.problem };
    const ownOpen =
      issue.state === "open" &&
      repositoriesOf(list).some((own) => sameRepository(own, issue.repository));
    const pageProblem = ownOpen
      ? loader.openIssuesOf(issue.repository)?.problem
      : undefined;
    return pageProblem
      ? { status: "failed", problem: pageProblem }
      : { status: "loading" };
  }

  /** The list's forest, as the store has it now. */
  function forestOf(list: ListState, tracked: RepositoryAddress[]): Forest {
    const trackedKeys = new Set(tracked.map(repositoryKey));
    const { expanded, except } = list.expansion;
    return buildForest({
      scope: list.scope,
      openIssueIds: repositoriesOf(list).flatMap((repository) => [
        ...(loader.openIssuesOf(repository)?.openIssueIds ?? []),
      ]),
      lookup: (id) => store.get(id),
      unread: (issue) => unreadIssue(list, issue),
      isTracked: (address) => trackedKeys.has(repositoryKey(address)),
      isExpanded: (id) => (except.has(id) ? !expanded : expanded),
    });
  }

  /**
   * Arranges the list's forest from the store, and asks for the issues it
   * names but has not read, and for those it shows that are older than it
   * needs them.
   */
  function arrange(list: ListState): IssueList {
    const { scope, tracked } = list;
    // Until the tracked repositories are known, external issues cannot be
    // told apart, nor All's repositories named.
    if (tracked === undefined) {
      return {
        scope,
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
    // An open issue of the list's repositories arrives with its page, also
    // as a page that failed is read again, unless it changed while the
    // pages were read.
    readMissing(
      list,
      [...forest.missing, ...outdated].filter((reference) => {
        if (reference.state === "closed") return true;
        if (
          !own.some((repository) =>
            sameRepository(repository, reference.repository),
          )
        ) {
          return true;
        }
        const load = loader.openIssuesOf(reference.repository);
        return load?.reading === false && load.problem === undefined;
      }),
    );
    return {
      scope,
      trees: forest.trees,
      loading: loadingOf(list, forest),
      repositories:
        scope.kind === "all"
          ? own.map((repository): RepositoryLoading => ({
              repository,
              loading: repositoryLoading(loader.openIssuesOf(repository)),
            }))
          : [],
    };
  }

  /** Pushes a list as it is now. */
  function update(list: ListState) {
    push(arrange(list));
  }

  /**
   * Reads the issues a list names but has not asked for since it needs them
   * newer, together with any other list that asks for them.
   */
  function readMissing(list: ListState, missing: Pick<IssueReference, "id">[]) {
    const ids = [
      ...new Set(
        missing.map(({ id }) => id).filter((id) => !list.requested.has(id)),
      ),
    ];
    for (const id of ids) list.requested.add(id);
    for (const read of loader.readIssues(ids, list.validFrom)) {
      void awaitRead(list, read);
    }
  }

  /** Updates a list once a read of issues it waits for has settled. */
  async function awaitRead(list: ListState, read: Promise<void>) {
    list.pendingRequests++;
    await read;
    list.pendingRequests--;
    update(list);
  }

  /**
   * Reads the tracked repositories, then starts reading the pages of the
   * list's repositories that are older than it needs.
   */
  async function start(list: ListState) {
    list.readingTracked = true;
    const read = await settings.read();
    list.readingTracked = false;
    if (!read.ok && list.scope.kind === "all") {
      list.settingsProblem = { kind: "error", message: read.message };
    }
    list.tracked = read.ok ? read.value.repositories : [];
    const own = repositoriesOf(list);
    // A list whose repositories other lists have read shows what they read,
    // while it reads again what is older than it needs.
    if (own.every((repository) => loader.openIssuesOf(repository)?.readAt)) {
      list.loaded = true;
    }
    // A repository that starts loading updates a list that has not loaded
    // with its first page; one that was read or is being read shows at once.
    let updateNow = list.loaded || list.settingsProblem !== undefined;
    for (const repository of own) {
      if (!loader.loadOpenIssues(repository, list.validFrom)) updateNow = true;
    }
    if (updateNow) update(list);
  }

  /** Reads everything a list shows again, from now on. */
  function refresh(list: ListState) {
    list.validFrom = clock();
    list.checkedAt = list.validFrom.time;
    list.requested.clear();
    list.settingsProblem = undefined;
    // Its repositories' pages start at once, so that their open issues are
    // not also asked for by ID.
    for (const repository of repositoriesOf(list)) {
      loader.loadOpenIssues(repository, list.validFrom);
    }
    void start(list);
    update(list);
  }

  /**
   * Reads again what of a list failed, GitHub would not show, or left out:
   * the tracked repositories, its repositories' open issues, the issues it
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
      if (loader.openIssuesOf(repository)?.problem) {
        loader.loadOpenIssues(repository, list.validFrom);
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
    );
    if (!retried && again.size === 0) return false;
    update(list);
    return true;
  }

  /** Starts a list, which takes what other lists read since `validFrom`. */
  function create(scope: Scope, validFrom: Moment) {
    const list: ListState = {
      scope,
      tracked: undefined,
      readingTracked: false,
      settingsProblem: undefined,
      validFrom,
      checkedAt: clock().time,
      requested: new Set(),
      pendingRequests: 0,
      expansion: { expanded: true, except: new Set() },
      loaded: false,
    };
    lists.set(scopeKey(scope), list);
    update(list);
    void start(list);
  }

  /**
   * How far a list has loaded and how current it is, with its counts. It
   * failed when none of its repositories' open issues could be read, and is
   * stale when what it shows could not be read again. A repository within
   * All that failed does not count, and shows in `repositories`.
   */
  function loadingOf(list: ListState, forest: Forest): ListLoading {
    if (list.settingsProblem) {
      return { status: "failed", problem: list.settingsProblem };
    }
    const loads = repositoriesOf(list).map((repository) =>
      loader.openIssuesOf(repository),
    );
    const reading =
      list.readingTracked ||
      list.pendingRequests > 0 ||
      loads.some((load) => load?.reading !== false);
    // Read again after it failed with nothing to show, it is loading anew.
    const anyRead = loads.some((load) => load?.readAt !== undefined);
    if (reading && (!list.loaded || (loads.length > 0 && !anyRead))) {
      return { status: "loading" };
    }
    const failures = loads.flatMap((load) =>
      load?.problem && !showsEarlierRead(load) ? [load.problem] : [],
    );
    const [firstFailure] = failures;
    if (firstFailure && failures.length === loads.length) {
      return { status: "failed", problem: firstFailure };
    }
    list.loaded = true;
    let openIssues = 0;
    let closedIssues = 0;
    let problem: Problem | undefined;
    // The list is as old as the oldest of what it shows.
    let updatedAt = Infinity;
    for (const load of loads) {
      if (!load || (!showsEarlierRead(load) && load.problem)) continue;
      openIssues += load.openIssueIds.size;
      closedIssues += load.closedIssueCount;
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
      openIssues,
      closedNotListed: Math.max(0, closedIssues - forest.closedShown),
    };
    if (reading) return { status: "refreshing", ...loaded };
    if (problem) return { status: "stale", problem, ...loaded };
    return { status: "current", ...loaded };
  }

  /** Updates an opened list after a change, if it is open. */
  function change(scope: Scope, apply: (list: ListState) => void) {
    const list = lists.get(scopeKey(scope));
    if (!list) return;
    apply(list);
    update(list);
  }

  /**
   * Reads an opened list again if it is older than five minutes, and
   * otherwise what of it failed, and says whether it pushed the list.
   */
  function revalidate(list: ListState): boolean {
    if (!isOutdated(arrange(list).loading, clock)) return retry(list);
    refresh(list);
    return true;
  }

  return {
    open(scope) {
      const known = lists.get(scopeKey(scope));
      if (!known) {
        // Opened for the first time, it takes what other lists have read in
        // the last five minutes.
        create(scope, fiveMinutesAgo(clock));
        return;
      }
      known.scope = scope;
      if (!revalidate(known)) update(known);
    },
    refresh(scope) {
      const known = lists.get(scopeKey(scope));
      if (known) refresh(known);
      else create(scope, clock());
    },
    revalidate(scope) {
      const known = lists.get(scopeKey(scope));
      if (known) revalidate(known);
    },
    retry(scope) {
      const known = lists.get(scopeKey(scope));
      if (known) retry(known);
    },
    setExpanded(scope, issueId, expanded) {
      change(scope, ({ expansion }) => {
        if (expanded === expansion.expanded) expansion.except.delete(issueId);
        else expansion.except.add(issueId);
      });
    },
    setAllExpanded(scope, expanded) {
      change(scope, (list) => {
        list.expansion = { expanded, except: new Set() };
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
