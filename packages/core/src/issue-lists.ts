import type {
  IssueList,
  ListLoading,
  RepositoryAddress,
  Scope,
} from "./contract.ts";
import { inBatches } from "./batches.ts";
import { buildRepositoryForest } from "./forest.ts";
import { describeGitHubError } from "./github/error-message.ts";
import type { SendRequest } from "./github/port.ts";
import type { IssueStore } from "./issue-store.ts";
import { repositoryKey, sameRepository } from "./repository-address.ts";

/**
 * The lists of the main area, one per scope, over the one issue store. A list
 * loads when it is first opened and is then reused for the session, together
 * with its expansion.
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
  /** The tracked repositories, to tell external issues apart. */
  trackedRepositories: () => Promise<RepositoryAddress[]>;
  /** Pushes a list's current state to the interfaces. */
  push: (list: IssueList) => void;
}

/** At most this many issues are read by ID in one request. */
const issuesPerRequest = 100;

/** Which issues a list shows, how far it has loaded, and what is expanded. */
interface ListState {
  /** The repository's open issues, as loaded so far. */
  openIssueIds: Set<string>;
  closedIssueCount: number;
  /** Whether the last page of open issues has arrived. */
  allPagesLoaded: boolean;
  /** Issues asked for by ID, so none is asked for twice. */
  requested: Set<string>;
  /** Requests for issues by ID that have not been answered yet. */
  pendingRequests: number;
  /** Why loading failed, once it has. */
  failure: string | undefined;
  tracked: RepositoryAddress[];
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
  trackedRepositories,
  push,
}: IssueListsOptions): IssueLists {
  const lists = new Map<string, ListState>();

  /**
   * Arranges the list's forest from the store, asks for the issues it names
   * but has not read, and pushes it.
   */
  function update(scope: Scope, list: ListState) {
    // A list that failed and was opened again has been replaced; what its
    // last requests read stays in the store for the new one.
    if (lists.get(scopeKey(scope)) !== list) return;
    const { repository } = scope;
    const { expanded, except } = list.expansion;
    const forest = buildRepositoryForest({
      repository,
      openIssueIds: list.openIssueIds,
      lookup: (id) => store.get(id),
      isTracked: (address) =>
        list.tracked.some((tracked) => sameRepository(tracked, address)),
      isExpanded: (id) => (except.has(id) ? !expanded : expanded),
    });
    if (list.failure === undefined) {
      // An open issue of this repository arrives with its page, unless it
      // changed while the pages were read.
      const wanted = forest.missing
        .filter(
          (reference) =>
            !list.requested.has(reference.id) &&
            (list.allPagesLoaded ||
              reference.state === "closed" ||
              !sameRepository(reference.repository, repository)),
        )
        .map((reference) => reference.id);
      for (const ids of inBatches(wanted, issuesPerRequest)) {
        void readIssues(scope, list, ids);
      }
    }
    push({
      scope,
      trees: forest.trees,
      loading: loadingOf(list, forest.closedShown),
    });
  }

  /** Reads issues the list names by ID, then updates it. */
  async function readIssues(scope: Scope, list: ListState, ids: string[]) {
    for (const id of ids) list.requested.add(id);
    list.pendingRequests++;
    const result = await request((github) => github.fetchIssues(ids));
    list.pendingRequests--;
    if (result.ok) store.put(result.value);
    else list.failure ??= describeGitHubError(result.error);
    update(scope, list);
  }

  /** Reads the scope's pages one after another, updating after each. */
  async function load(scope: Scope, list: ListState) {
    list.tracked = await trackedRepositories();
    let after: string | undefined;
    do {
      const cursor = after;
      const result = await request((github) =>
        github.fetchOpenIssues(scope.repository, cursor),
      );
      if (result.ok) {
        store.put(result.value.issues);
        for (const issue of result.value.issues) {
          list.openIssueIds.add(issue.id);
        }
        list.closedIssueCount = result.value.closedIssueCount;
        after = result.value.nextPage;
        list.allPagesLoaded = after === undefined;
      } else {
        list.failure ??= describeGitHubError(result.error);
      }
      update(scope, list);
    } while (after !== undefined && list.failure === undefined);
  }

  /** Updates an opened list after a change, if it is open. */
  function change(scope: Scope, apply: (list: ListState) => void) {
    const list = lists.get(scopeKey(scope));
    if (!list) return;
    apply(list);
    update(scope, list);
  }

  return {
    open(scope) {
      const key = scopeKey(scope);
      const known = lists.get(key);
      // A list that is loading or loaded is reused; one that failed starts over.
      if (known && known.failure === undefined) {
        update(scope, known);
        return;
      }
      const list: ListState = {
        openIssueIds: new Set(),
        closedIssueCount: 0,
        allPagesLoaded: false,
        requested: new Set(),
        pendingRequests: 0,
        failure: undefined,
        tracked: [],
        expansion: known?.expansion ?? { expanded: true, except: new Set() },
      };
      lists.set(key, list);
      update(scope, list);
      void load(scope, list);
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

/** How far a list has loaded, with its counts once it has. */
function loadingOf(list: ListState, closedShown: number): ListLoading {
  if (list.failure !== undefined) {
    return { status: "failed", message: list.failure };
  }
  if (!list.allPagesLoaded || list.pendingRequests > 0) {
    return { status: "loading" };
  }
  return {
    status: "loaded",
    openIssues: list.openIssueIds.size,
    closedNotListed: Math.max(0, list.closedIssueCount - closedShown),
  };
}

/** Tells scopes apart, whatever the case of the repository's name. */
function scopeKey({ repository }: Scope): string {
  return `repository:${repositoryKey(repository)}`;
}
