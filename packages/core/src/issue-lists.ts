import type {
  IssueList,
  IssueSummary,
  ListLoading,
  Scope,
} from "./contract.ts";
import { describeGitHubError } from "./github/error-message.ts";
import type { GitHubAccess, Issue } from "./github/port.ts";
import type { IssueStore } from "./issue-store.ts";

/**
 * The lists of the main area, one per scope, over the one issue store. A list
 * loads when it is first opened and is then reused for the session.
 */
export interface IssueLists {
  /**
   * Pushes a scope's list at once. If it has not loaded or has failed, loads
   * the scope page by page, pushing the list after each page.
   */
  open(scope: Scope): void;
}

export interface IssueListsOptions {
  store: IssueStore;
  /** Sends one GitHub request through the request queue. */
  request: <T>(send: (github: GitHubAccess) => Promise<T>) => Promise<T>;
  /** Pushes a list's current state to the interfaces. */
  push: (list: IssueList) => void;
}

/** Which stored issues a list shows, in order, and how far it has loaded. */
interface ListState {
  issueIds: Set<string>;
  loading: ListLoading;
}

export function createIssueLists({
  store,
  request,
  push,
}: IssueListsOptions): IssueLists {
  const lists = new Map<string, ListState>();

  function pushList(scope: Scope, list: ListState) {
    push({
      scope,
      issues: [...list.issueIds].flatMap((id) => {
        const issue = store.get(id);
        return issue ? [summarize(issue)] : [];
      }),
      loading: list.loading,
    });
  }

  /** Reads the scope's pages one after another, pushing each. */
  async function load(scope: Scope, list: ListState) {
    let after: string | undefined;
    while (list.loading.status === "loading") {
      const cursor = after;
      const result = await request((github) =>
        github.fetchOpenIssues(scope.repository, cursor),
      );
      if (result.ok) {
        store.put(result.value.issues);
        for (const issue of result.value.issues) list.issueIds.add(issue.id);
        after = result.value.nextPage;
        if (after === undefined) list.loading = { status: "loaded" };
      } else {
        const message = describeGitHubError(result.error);
        list.loading = { status: "failed", message };
      }
      pushList(scope, list);
    }
  }

  return {
    open(scope) {
      const key = scopeKey(scope);
      const known = lists.get(key);
      // A list that is loading or loaded is reused; one that failed starts over.
      if (known && known.loading.status !== "failed") {
        pushList(scope, known);
        return;
      }
      const list: ListState = {
        issueIds: new Set(),
        loading: { status: "loading" },
      };
      lists.set(key, list);
      pushList(scope, list);
      void load(scope, list);
    },
  };
}

/** Tells scopes apart. */
function scopeKey({ repository }: Scope): string {
  return `repository:${repository.owner}/${repository.name}`;
}

/** What a list shows of a stored issue. */
function summarize({ id, number, title, state }: Issue): IssueSummary {
  return { id, number, title, state };
}
