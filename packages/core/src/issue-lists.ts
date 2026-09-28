import type {
  IssueList,
  IssueNode,
  ListLoading,
  LoadingState,
  RepositoryAddress,
  RepositoryLoading,
  Scope,
} from "./contract.ts";
import { buildForest, type Forest } from "./forest.ts";
import { describeGitHubError } from "./github/error-message.ts";
import type { IssueReference, SendRequest } from "./github/port.ts";
import {
  createIssueLoader,
  type IssueRead,
  type RepositoryIssues,
} from "./issue-loader.ts";
import type { IssueStore } from "./issue-store.ts";
import {
  atOrAfter,
  fiveMinutesAgo,
  isOutdated,
  type Clock,
  type Moment,
} from "./moments.ts";
import {
  distinctRepositories,
  nameWithOwner,
  repositoryKey,
  sameRepository,
} from "./repository-address.ts";
import type { SettingsStorage } from "./settings/port.ts";

/**
 * The lists of the main area, one per scope, over the one issue store. A list
 * loads when it is first opened and is then kept for the session, together
 * with its expansion, and read again when it is refreshed or has grown old.
 * The issue loader reads a repository's open issues for its own list or for
 * All, whichever needs them, and they serve both.
 */
export interface IssueLists {
  /**
   * Pushes a scope's list at once. If it has not loaded or has failed, loads
   * the scope, pushing the list after each response; if it is older than
   * five minutes, reads it again the same way while it shows what it has.
   */
  open(scope: Scope): void;
  /**
   * Reads everything a scope's list shows again now: its repositories' open
   * issues, and the other issues it shows, with the sub-issues of expanded
   * ones. What it has shows meanwhile.
   */
  refresh(scope: Scope): void;
  /** Reads an opened list again if it is older than five minutes. */
  revalidate(scope: Scope): void;
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
  /**
   * What the list shows must have been read from GitHub at this moment or
   * later; anything older is read again as it shows.
   */
  validFrom: Moment;
  /** When it was last opened or refreshed, in milliseconds since the epoch. */
  checkedAt: number;
  /** Issues asked for by ID since `validFrom`, so none is asked for twice. */
  requested: Set<string>;
  /** Reads of issues by ID the list waits for. */
  pendingRequests: number;
  /**
   * Why reading issues by ID failed, or in All the tracked repositories, once
   * it has.
   */
  failure: string | undefined;
  expansion: Expansion;
  /** Whether everything it showed has loaded at some point. */
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
    const trackedKeys = new Set(tracked.map(repositoryKey));
    const { expanded, except } = list.expansion;
    const forest = buildForest({
      scope,
      openIssueIds: own.flatMap((repository) => [
        ...(loader.openIssuesOf(repository)?.openIssueIds ?? []),
      ]),
      lookup: (id) => store.get(id),
      isTracked: (address) => trackedKeys.has(repositoryKey(address)),
      isExpanded: (id) => (except.has(id) ? !expanded : expanded),
    });
    if (list.failure === undefined) {
      const outdated = shownIssues(forest.trees).flatMap((id) => {
        const readAt = store.readAt(id);
        const issue = store.get(id);
        return issue && readAt && !atOrAfter(readAt, list.validFrom)
          ? [issue]
          : [];
      });
      // An open issue of the list's repositories arrives with its page,
      // unless it changed while the pages were read.
      readMissing(
        list,
        [...forest.missing, ...outdated].filter(
          (reference) =>
            reference.state === "closed" ||
            !own.some((repository) =>
              sameRepository(repository, reference.repository),
            ) ||
            loader.openIssuesOf(reference.repository)?.reading !== true,
        ),
      );
    }
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

  /** Pushes a list as it is now, if it is the scope's. */
  function update(list: ListState) {
    // A list that failed and was opened again has been replaced; what its
    // last requests read stays in the store for the new one.
    if (lists.get(scopeKey(list.scope)) !== list) return;
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
  async function awaitRead(list: ListState, read: Promise<IssueRead>) {
    list.pendingRequests++;
    const result = await read;
    list.pendingRequests--;
    if (!result.ok) list.failure ??= describeGitHubError(result.error);
    update(list);
  }

  /**
   * Reads the tracked repositories, then starts reading the pages of the
   * list's repositories that are older than it needs them.
   */
  async function start(list: ListState) {
    list.readingTracked = true;
    const read = await settings.read();
    list.readingTracked = false;
    if (!read.ok && list.scope.kind === "all") list.failure = read.message;
    list.tracked = read.ok ? read.value.repositories : [];
    const own = repositoriesOf(list);
    // A list whose repositories other lists have read shows what they read,
    // while it reads again what is older than it needs.
    if (own.every((repository) => loader.openIssuesOf(repository)?.readAt)) {
      list.loaded = true;
    }
    // A repository that starts loading updates a list that has not loaded
    // with its first page; one that was read or is being read shows at once.
    let updateNow = list.loaded;
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
    // Its repositories' pages start at once, so that their open issues are
    // not also asked for by ID.
    for (const repository of repositoriesOf(list)) {
      loader.loadOpenIssues(repository, list.validFrom);
    }
    void start(list);
    update(list);
  }

  /**
   * Starts a list over, keeping its expansion. One that failed keeps showing
   * what it showed while it is read again.
   */
  function create(scope: Scope, validFrom: Moment): ListState {
    const key = scopeKey(scope);
    const previous = lists.get(key);
    const list: ListState = {
      scope,
      tracked: previous?.tracked,
      readingTracked: false,
      validFrom,
      checkedAt: clock().time,
      requested: new Set(),
      pendingRequests: 0,
      failure: undefined,
      expansion: previous?.expansion ?? {
        expanded: true,
        except: new Set(),
      },
      loaded: false,
    };
    lists.set(key, list);
    // Its repositories' pages start at once, so that it shows as loading
    // again rather than as it failed.
    if (list.tracked !== undefined) {
      for (const repository of repositoriesOf(list)) {
        loader.loadOpenIssues(repository, validFrom);
      }
    }
    update(list);
    void start(list);
    return list;
  }

  /** How far a list has loaded and how current it is, with its counts. */
  function loadingOf(list: ListState, forest: Forest): ListLoading {
    const failure = failureOf(list);
    if (failure !== undefined) return { status: "failed", message: failure };
    const loads = repositoriesOf(list).map((repository) =>
      loader.openIssuesOf(repository),
    );
    const reading =
      list.readingTracked ||
      list.pendingRequests > 0 ||
      loads.some((load) => load?.reading !== false);
    if (!list.loaded && reading) return { status: "loading" };
    list.loaded = true;
    let openIssues = 0;
    let closedIssues = 0;
    // The list is as old as the oldest of what it shows.
    let updatedAt = Infinity;
    for (const load of loads) {
      openIssues += load?.openIssueIds.size ?? 0;
      closedIssues += load?.closedIssueCount ?? 0;
      updatedAt = Math.min(updatedAt, load?.readAt?.time ?? Infinity);
    }
    for (const id of shownIssues(forest.trees)) {
      updatedAt = Math.min(updatedAt, store.readAt(id)?.time ?? Infinity);
    }
    return {
      status: reading ? "refreshing" : "current",
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : list.checkedAt,
      openIssues,
      closedNotListed: Math.max(0, closedIssues - forest.closedShown),
    };
  }

  /**
   * Why a list could not load: its repositories' pages, each named in All,
   * then the list's own reads.
   */
  function failureOf(list: ListState): string | undefined {
    const failures: string[] = [];
    for (const repository of repositoriesOf(list)) {
      const failure = loader.openIssuesOf(repository)?.failure;
      if (failure === undefined) continue;
      failures.push(
        list.scope.kind === "all"
          ? `${nameWithOwner(repository)}: ${failure}`
          : failure,
      );
    }
    if (list.failure !== undefined) failures.push(list.failure);
    return failures.length > 0 ? failures.join("\n") : undefined;
  }

  /** Updates an opened list after a change, if it is open. */
  function change(scope: Scope, apply: (list: ListState) => void) {
    const list = lists.get(scopeKey(scope));
    if (!list) return;
    apply(list);
    update(list);
  }

  /** An opened list that is loading or has loaded, to be reused. */
  function reusable(scope: Scope): ListState | undefined {
    const known = lists.get(scopeKey(scope));
    if (known?.tracked !== undefined && failureOf(known) !== undefined) {
      return undefined;
    }
    return known;
  }

  return {
    open(scope) {
      const known = reusable(scope);
      if (!known) {
        // Opened for the first time, it takes what other lists have read in
        // the last five minutes.
        create(scope, fiveMinutesAgo(clock));
        return;
      }
      known.scope = scope;
      const shown = arrange(known);
      if (isOutdated(shown.loading, clock)) refresh(known);
      else push(shown);
    },
    refresh(scope) {
      const known = reusable(scope);
      if (known) refresh(known);
      else create(scope, clock());
    },
    revalidate(scope) {
      const known = reusable(scope);
      if (known && isOutdated(arrange(known).loading, clock)) refresh(known);
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

/** How far a repository's open issues have loaded, and how current they are. */
function repositoryLoading(load: RepositoryIssues | undefined): LoadingState {
  if (load?.failure !== undefined) {
    return { status: "failed", message: load.failure };
  }
  if (load?.readAt === undefined) return { status: "loading" };
  return {
    status: load.reading ? "refreshing" : "current",
    updatedAt: load.readAt.time,
  };
}

/**
 * The issues a forest shows: its trees, and below each the sub-issues of the
 * expanded ones.
 */
function shownIssues(trees: readonly IssueNode[]): string[] {
  return trees.flatMap((node) => [
    node.issue.id,
    ...(node.expanded ? shownIssues(node.subIssues) : []),
  ]);
}

/** Tells scopes apart, whatever the case of a repository's name. */
function scopeKey(scope: Scope): string {
  return scope.kind === "all"
    ? "all"
    : `repository:${repositoryKey(scope.repository)}`;
}
