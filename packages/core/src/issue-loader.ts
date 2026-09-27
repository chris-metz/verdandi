import type { RepositoryAddress } from "./contract.ts";
import { inBatches } from "./batches.ts";
import { describeGitHubError } from "./github/error-message.ts";
import type { GitHubResult, Issue, SendRequest } from "./github/port.ts";
import type { IssueStore } from "./issue-store.ts";
import { repositoryKey } from "./repository-address.ts";

/**
 * Reads issues from GitHub into the one store, for every list: a
 * repository's open issues page by page, once per session unless reading
 * them failed, and other issues by ID, sharing a read that is under way with
 * every list that names the same issue.
 */
export interface IssueLoader {
  /** How far a repository's open issues have been read, once asked for. */
  openIssuesOf(repository: RepositoryAddress): RepositoryIssues | undefined;
  /**
   * Starts reading a repository's open issues, unless they are loaded or
   * loading, and says whether it did. After a failure they are read again.
   */
  loadOpenIssues(repository: RepositoryAddress): boolean;
  /**
   * Reads issues by ID into the store. Issues a read under way already asks
   * for join it; the rest are asked for up to 100 at a time. Returns every
   * read that brings them.
   */
  readIssues(ids: readonly string[]): Promise<IssueRead>[];
}

/** GitHub's answer to a read of issues by ID, already kept in the store. */
export type IssueRead = GitHubResult<Issue[]>;

/** A repository's open issues, as far as they have been read. */
export interface RepositoryIssues {
  readonly openIssueIds: ReadonlySet<string>;
  readonly closedIssueCount: number;
  /** Whether the last page of open issues has arrived. */
  readonly allPagesLoaded: boolean;
  /** Why reading a page failed, once it has. */
  readonly failure: string | undefined;
}

export interface IssueLoaderOptions {
  store: IssueStore;
  request: SendRequest;
  /** Takes each page of a repository's open issues, read or failed. */
  pageRead: (repository: RepositoryAddress) => void;
  /** Takes a repository's open-issue count once all its open issues loaded. */
  openIssuesLoaded: (repository: RepositoryAddress, openIssues: number) => void;
}

/** At most this many issues are read by ID in one request. */
const issuesPerRequest = 100;

/** A repository's open issues while they are being read. */
interface Pages {
  openIssueIds: Set<string>;
  closedIssueCount: number;
  allPagesLoaded: boolean;
  failure: string | undefined;
}

export function createIssueLoader({
  store,
  request,
  pageRead,
  openIssuesLoaded,
}: IssueLoaderOptions): IssueLoader {
  /** Each repository's open issues, by `repositoryKey`. */
  const repositories = new Map<string, Pages>();
  /** Reads of issues by ID under way, by issue. */
  const reading = new Map<string, Promise<IssueRead>>();

  /** Asks for issues by ID in one request, keeping what GitHub returns. */
  function read(ids: string[]): Promise<IssueRead> {
    const answer = request((github) => github.fetchIssues(ids)).then(
      (result) => {
        for (const id of ids) {
          if (reading.get(id) === answer) reading.delete(id);
        }
        if (result.ok) store.put(result.value);
        return result;
      },
    );
    for (const id of ids) reading.set(id, answer);
    return answer;
  }

  /** Reads a repository's pages one after another, reporting each. */
  async function readPages(repository: RepositoryAddress, pages: Pages) {
    let after: string | undefined;
    do {
      const cursor = after;
      const result = await request((github) =>
        github.fetchOpenIssues(repository, cursor),
      );
      if (result.ok) {
        store.put(result.value.issues);
        for (const issue of result.value.issues) {
          pages.openIssueIds.add(issue.id);
        }
        pages.closedIssueCount = result.value.closedIssueCount;
        after = result.value.nextPage;
        pages.allPagesLoaded = after === undefined;
        if (pages.allPagesLoaded) {
          openIssuesLoaded(repository, pages.openIssueIds.size);
        }
      } else {
        pages.failure = describeGitHubError(result.error);
      }
      pageRead(repository);
    } while (after !== undefined && pages.failure === undefined);
  }

  return {
    openIssuesOf(repository) {
      return repositories.get(repositoryKey(repository));
    },
    loadOpenIssues(repository) {
      const known = repositories.get(repositoryKey(repository));
      if (known && known.failure === undefined) return false;
      const pages: Pages = {
        openIssueIds: new Set(),
        closedIssueCount: 0,
        allPagesLoaded: false,
        failure: undefined,
      };
      repositories.set(repositoryKey(repository), pages);
      void readPages(repository, pages);
      return true;
    },
    readIssues(ids) {
      const reads = new Set<Promise<IssueRead>>();
      const unread: string[] = [];
      for (const id of ids) {
        const underWay = reading.get(id);
        if (underWay) reads.add(underWay);
        else unread.push(id);
      }
      for (const batch of inBatches(unread, issuesPerRequest)) {
        reads.add(read(batch));
      }
      return [...reads];
    },
  };
}
