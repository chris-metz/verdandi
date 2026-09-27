import type {
  IssueList,
  ListLoading,
  RepositoryAddress,
  Scope,
} from "./contract.ts";
import { buildForest } from "./forest.ts";
import { describeGitHubError } from "./github/error-message.ts";
import type { IssueReference, SendRequest } from "./github/port.ts";
import { createIssueLoader, type IssueRead } from "./issue-loader.ts";
import type { IssueStore } from "./issue-store.ts";
import {
  distinctRepositories,
  nameWithOwner,
  repositoryKey,
  sameRepository,
} from "./repository-address.ts";
import type { SettingsStorage } from "./settings/port.ts";

/**
 * The lists of the main area, one per scope, over the one issue store. A list
 * loads when it is first opened and is then reused for the session, together
 * with its expansion. The issue loader reads a repository's open issues once,
 * for its own list or for All, whichever is opened first, and they serve both.
 */
export interface IssueLists {
  /**
   * Pushes a scope's list at once. If it has not loaded or has failed, loads
   * the scope, pushing the list after each response.
   */
  open(scope: Scope): void;
  /** Expands or collapses one issue in an opened list, and pushes it. */
  setExpanded(scope: Scope, issueId: string, expanded: boolean): void;
  /** Expands or collapses every issue in an opened list, and pushes it. */
  setAllExpanded(scope: Scope, expanded: boolean): void;
}

export interface IssueListsOptions {
  store: IssueStore;
  request: SendRequest;
  /**
   * Where the tracked repositories are listed: the ones All merges, and the
   * ones whose issues are not external.
   */
  settings: SettingsStorage;
  /** Pushes a list's current state to the interfaces. */
  push: (list: IssueList) => void;
  /** Takes a repository's open-issue count once all its open issues loaded. */
  openIssuesLoaded: (repository: RepositoryAddress, openIssues: number) => void;
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
  /** Issues asked for by ID, so none is asked for twice. */
  requested: Set<string>;
  /** Reads of issues by ID the list waits for. */
  pendingRequests: number;
  /**
   * Why reading issues by ID failed, or in All the tracked repositories, once
   * it has.
   */
  failure: string | undefined;
  expansion: Expansion;
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
  settings,
  push,
  openIssuesLoaded,
}: IssueListsOptions): IssueLists {
  const lists = new Map<string, ListState>();
  const loader = createIssueLoader({
    store,
    request,
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
   * Arranges the list's forest from the store, asks for the issues it names
   * but has not read, and pushes it.
   */
  function update(list: ListState) {
    // A list that failed and was opened again has been replaced; what its
    // last requests read stays in the store for the new one.
    if (lists.get(scopeKey(list.scope)) !== list) return;
    const { scope, tracked } = list;
    // Until the tracked repositories are known, external issues cannot be
    // told apart, nor All's repositories named.
    if (tracked === undefined) {
      push({ scope, trees: [], loading: { status: "loading" } });
      return;
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
      // An open issue of the list's repositories arrives with its page,
      // unless it changed while the pages were read.
      readMissing(
        list,
        forest.missing.filter(
          (reference) =>
            reference.state === "closed" ||
            !own.some((repository) =>
              sameRepository(repository, reference.repository),
            ) ||
            loader.openIssuesOf(reference.repository)?.allPagesLoaded !== false,
        ),
      );
    }
    push({
      scope,
      trees: forest.trees,
      loading: loadingOf(list, forest.closedShown),
    });
  }

  /**
   * Reads the issues a list names but has not asked for, together with any
   * other list that asks for them.
   */
  function readMissing(list: ListState, missing: IssueReference[]) {
    const ids = missing
      .map(({ id }) => id)
      .filter((id) => !list.requested.has(id));
    for (const id of ids) list.requested.add(id);
    for (const read of loader.readIssues(ids)) void awaitRead(list, read);
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
   * list's repositories that have not been read.
   */
  async function start(list: ListState) {
    const read = await settings.read();
    if (!read.ok && list.scope.kind === "all") list.failure = read.message;
    list.tracked = read.ok ? read.value.repositories : [];
    const own = repositoriesOf(list);
    // A repository that starts loading updates the list with its first page;
    // one that was read or is being read shows at once.
    let updateNow = own.length === 0;
    for (const repository of own) {
      if (!loader.loadOpenIssues(repository)) updateNow = true;
    }
    if (updateNow) update(list);
  }

  /** How far a list has loaded, with its counts once it has. */
  function loadingOf(list: ListState, closedShown: number): ListLoading {
    const failure = failureOf(list);
    if (failure !== undefined) return { status: "failed", message: failure };
    const loads = repositoriesOf(list).map((repository) =>
      loader.openIssuesOf(repository),
    );
    if (
      list.pendingRequests > 0 ||
      loads.some((load) => !load?.allPagesLoaded)
    ) {
      return { status: "loading" };
    }
    let openIssues = 0;
    let closedIssues = 0;
    for (const load of loads) {
      openIssues += load?.openIssueIds.size ?? 0;
      closedIssues += load?.closedIssueCount ?? 0;
    }
    return {
      status: "loaded",
      openIssues,
      closedNotListed: Math.max(0, closedIssues - closedShown),
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

  return {
    open(scope) {
      const key = scopeKey(scope);
      const known = lists.get(key);
      // A list that is loading or loaded is reused; one that failed starts over.
      if (
        known &&
        (known.tracked === undefined || failureOf(known) === undefined)
      ) {
        known.scope = scope;
        update(known);
        return;
      }
      const list: ListState = {
        scope,
        tracked: undefined,
        requested: new Set(),
        pendingRequests: 0,
        failure: undefined,
        expansion: known?.expansion ?? { expanded: true, except: new Set() },
      };
      lists.set(key, list);
      update(list);
      void start(list);
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

/** Tells scopes apart, whatever the case of a repository's name. */
function scopeKey(scope: Scope): string {
  return scope.kind === "all"
    ? "all"
    : `repository:${repositoryKey(scope.repository)}`;
}
