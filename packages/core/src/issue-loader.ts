import type { RepositoryAddress } from "./contract.ts";
import { inBatches } from "./batches.ts";
import { describeGitHubError } from "./github/error-message.ts";
import type { GitHubResult, Issue, SendRequest } from "./github/port.ts";
import type { IssueStore } from "./issue-store.ts";
import { atOrAfter, type Clock, type Moment } from "./moments.ts";
import { repositoryKey } from "./repository-address.ts";

/**
 * Reads issues from GitHub into the one store, for every list: a
 * repository's open issues page by page, and other issues by ID, sharing a
 * read that is under way with every list that names the same issue. What a
 * list needs no older than a moment is read again only if it is older.
 */
export interface IssueLoader {
  /** How far a repository's open issues have been read, once asked for. */
  openIssuesOf(repository: RepositoryAddress): RepositoryIssues | undefined;
  /**
   * Starts reading a repository's open issues, unless a read that started at
   * `since` or later has not failed, and says whether it did. A read that
   * starts supersedes one under way.
   */
  loadOpenIssues(repository: RepositoryAddress, since: Moment): boolean;
  /**
   * Reads issues by ID into the store. Issues a read under way, asked at
   * `since` or later, already asks for join it; the rest are asked for up to
   * 100 at a time. Returns every read that brings them.
   */
  readIssues(ids: readonly string[], since: Moment): Promise<IssueRead>[];
}

/** GitHub's answer to a read of issues by ID, already kept in the store. */
export type IssueRead = GitHubResult<Issue[]>;

/**
 * A repository's open issues: those of the last complete read, which stay
 * while they are read again, or, until one completed, as far as the first
 * read has come.
 */
export interface RepositoryIssues {
  readonly openIssueIds: ReadonlySet<string>;
  readonly closedIssueCount: number;
  /** When the last complete read started; none until a read completed. */
  readonly readAt: Moment | undefined;
  /** Whether a read is under way. */
  readonly reading: boolean;
  /** Why the latest read failed, if it did. */
  readonly failure: string | undefined;
}

export interface IssueLoaderOptions {
  store: IssueStore;
  request: SendRequest;
  clock: Clock;
  /** Takes each page of a repository's open issues, read or failed. */
  pageRead: (repository: RepositoryAddress) => void;
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

/** At most this many issues are read by ID in one request. */
const issuesPerRequest = 100;

/** One read of a repository's open issues, page by page. */
interface Read {
  startedAt: Moment;
  openIssueIds: Set<string>;
  closedIssueCount: number;
  done: boolean;
  failure: string | undefined;
}

/** A repository's reads: the last complete one, and the latest. */
interface Reads {
  complete: Read | undefined;
  latest: Read;
}

/** A read of issues by ID under way. */
interface ReadUnderWay {
  answer: Promise<IssueRead>;
  askedAt: Moment;
}

export function createIssueLoader({
  store,
  request,
  clock,
  pageRead,
  openIssuesLoaded,
}: IssueLoaderOptions): IssueLoader {
  /** Each repository's reads of its open issues, by `repositoryKey`. */
  const repositories = new Map<string, Reads>();
  /** Reads of issues by ID under way, by issue. */
  const reading = new Map<string, ReadUnderWay>();

  /** Asks for issues by ID in one request, keeping what GitHub returns. */
  function read(ids: string[]): Promise<IssueRead> {
    const askedAt = clock();
    const answer = request((github) => github.fetchIssues(ids)).then(
      (result) => {
        for (const id of ids) {
          if (reading.get(id)?.answer === answer) reading.delete(id);
        }
        if (result.ok) store.put(result.value, askedAt);
        return result;
      },
    );
    for (const id of ids) reading.set(id, { answer, askedAt });
    return answer;
  }

  /**
   * Reads a repository's pages one after another, reporting each, until
   * they are done, one fails, or a later read supersedes this one.
   */
  async function readPages(repository: RepositoryAddress, reads: Reads) {
    const thisRead = reads.latest;
    let after: string | undefined;
    do {
      const cursor = after;
      const askedAt = clock();
      const result = await request((github) =>
        github.fetchOpenIssues(repository, cursor),
      );
      // What a superseded read brings is still as new as anything.
      if (result.ok) store.put(result.value.issues, askedAt);
      if (reads.latest !== thisRead) return;
      if (result.ok) {
        for (const issue of result.value.issues) {
          thisRead.openIssueIds.add(issue.id);
        }
        thisRead.closedIssueCount = result.value.closedIssueCount;
        after = result.value.nextPage;
        if (after === undefined) {
          thisRead.done = true;
          reads.complete = thisRead;
          openIssuesLoaded(
            repository,
            thisRead.openIssueIds.size,
            thisRead.startedAt,
          );
        }
      } else {
        thisRead.failure = describeGitHubError(result.error);
      }
      pageRead(repository);
    } while (after !== undefined && thisRead.failure === undefined);
  }

  return {
    openIssuesOf(repository) {
      const reads = repositories.get(repositoryKey(repository));
      if (!reads) return undefined;
      const { complete, latest } = reads;
      const shown = complete ?? latest;
      return {
        openIssueIds: shown.openIssueIds,
        closedIssueCount: shown.closedIssueCount,
        readAt: complete?.startedAt,
        reading: !latest.done && latest.failure === undefined,
        failure: latest.failure,
      };
    },
    loadOpenIssues(repository, since) {
      const key = repositoryKey(repository);
      const known = repositories.get(key);
      if (
        known &&
        known.latest.failure === undefined &&
        atOrAfter(known.latest.startedAt, since)
      ) {
        return false;
      }
      const latest: Read = {
        startedAt: clock(),
        openIssueIds: new Set(),
        closedIssueCount: 0,
        done: false,
        failure: undefined,
      };
      const reads: Reads = known ?? { complete: undefined, latest };
      reads.latest = latest;
      repositories.set(key, reads);
      void readPages(repository, reads);
      return true;
    },
    readIssues(ids, since) {
      const reads = new Set<Promise<IssueRead>>();
      const unread: string[] = [];
      for (const id of ids) {
        const underWay = reading.get(id);
        if (underWay && atOrAfter(underWay.askedAt, since)) {
          reads.add(underWay.answer);
        } else unread.push(id);
      }
      for (const batch of inBatches(unread, issuesPerRequest)) {
        reads.add(read(batch));
      }
      return [...reads];
    },
  };
}
