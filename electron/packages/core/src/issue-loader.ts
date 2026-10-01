import type { IssueState, Problem, RepositoryAddress } from "./contract.ts";
import { inBatches } from "./batches.ts";
import { describeGitHubError } from "./github/error-message.ts";
import type { GitHubError } from "./github/port.ts";
import { keepAnswer, type IssueStore } from "./issue-store.ts";
import { atOrAfter, type Clock, type Moment } from "./moments.ts";
import { problemOf } from "./problems.ts";
import { repositoryKey } from "./repository-address.ts";
import {
  interrupted,
  mostUrgent,
  type SendRequest,
  type Urgency,
} from "./request-queue.ts";

/**
 * Reads issues from GitHub into the one store, for every list: a
 * repository's open or closed issues page by page, and other issues by ID,
 * sharing a read that is under way with every list that names the same
 * issue. What a list needs no older than a moment is read again only if it
 * is older. A read is as urgent as the most urgent list that waits for it,
 * and dropped unsent once none needs it.
 */
export interface IssueLoader {
  /**
   * How far a repository's issues in a state have been read, once asked
   * for.
   */
  issuesOf(
    repository: RepositoryAddress,
    state: IssueState,
  ): RepositoryIssues | undefined;
  /**
   * Starts reading a repository's issues in a state, unless a read that
   * started at `since` or later has not failed, and says whether it did. A
   * read that starts supersedes one under way.
   */
  loadIssues(
    repository: RepositoryAddress,
    state: IssueState,
    since: Moment,
  ): boolean;
  /**
   * Reads issues by ID into the store, or why they could not be read, as
   * urgently as `urgency` says. Issues a read under way, asked at `since` or
   * later, already asks for join it; the rest are asked for up to 100 at a
   * time. Returns every read that brings them.
   */
  readIssues(
    ids: readonly string[],
    since: Moment,
    urgency: (id: string) => Urgency | undefined,
  ): Promise<void>[];
  /** Whether an issue is being read by ID. */
  isReading(id: string): boolean;
  /**
   * Keeps what was read of a repository's issues under its new address, as
   * it was renamed or transferred.
   */
  renameRepository(from: RepositoryAddress, to: RepositoryAddress): void;
}

/**
 * A repository's issues in one state: those of the last complete read, which
 * stay while they are read again, or, until one completed, as far as the
 * first read has come. None once GitHub would no longer show the repository.
 */
export interface RepositoryIssues {
  readonly issueIds: ReadonlySet<string>;
  /**
   * How many closed issues the repository has, as the pages count them;
   * unknown until one has arrived.
   */
  readonly closedIssueCount: number | undefined;
  /** When the last complete read started; none until a read completed. */
  readonly readAt: Moment | undefined;
  /** Whether a read is under way. */
  readonly reading: boolean;
  /** Why the latest read failed, if it did. */
  readonly problem: Problem | undefined;
}

export interface IssueLoaderOptions {
  issuesFailed: (
    repository: RepositoryAddress,
    problem: Problem,
    readAt: Moment,
  ) => void;
  store: IssueStore;
  request: SendRequest;
  clock: Clock;
  /**
   * How urgently the lists that show a repository need its issues in a
   * state, or none once no list on screen shows them.
   */
  pagesUrgency: (
    repository: RepositoryAddress,
    state: IssueState,
  ) => Urgency | undefined;
  /** Takes each page of a repository's issues in a state, read or failed. */
  pageRead: (repository: RepositoryAddress, state: IssueState) => void;
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

/** One read of a repository's issues in a state, page by page. */
interface Read {
  startedAt: Moment;
  issueIds: Set<string>;
  closedIssueCount: number | undefined;
  done: boolean;
  problem: Problem | undefined;
}

/** A repository's reads: the last complete one, and the latest. */
interface Reads {
  complete: Read | undefined;
  latest: Read;
}

/** A read of issues by ID under way. */
interface ReadUnderWay {
  answer: Promise<void>;
  askedAt: Moment;
  /** How urgently each list that waits for it needs it. */
  needs: ((id: string) => Urgency | undefined)[];
}

export function createIssueLoader({
  store,
  request,
  clock,
  pagesUrgency,
  pageRead,
  openIssuesLoaded,
  issuesFailed,
}: IssueLoaderOptions): IssueLoader {
  /** Each repository's reads of its issues, by state and `repositoryKey`. */
  const repositories = new Map<string, Reads>();
  /** Reads of issues by ID under way, by issue. */
  const reading = new Map<string, ReadUnderWay>();

  /**
   * Asks for issues by ID in one request, keeping what GitHub returns, and
   * why it did not return the others.
   */
  function read(
    ids: string[],
    urgency: (id: string) => Urgency | undefined,
  ): Promise<void> {
    const askedAt = clock();
    const needs = [urgency];
    const urgencyOf = (id: string) => mostUrgent(needs.map((need) => need(id)));
    let sent: string[] = [];
    const answer = request(
      "fetchIssues",
      () => {
        sent = ids.filter((id) => urgencyOf(id) !== undefined);
        return [sent];
      },
      () => mostUrgent(ids.map(urgencyOf)),
    ).then((result) => {
      for (const id of ids) {
        if (reading.get(id)?.answer === answer) reading.delete(id);
      }
      keepAnswer(store, sent, result, askedAt);
      keepAnswer(
        store,
        ids.filter((id) => !sent.includes(id)),
        interrupted,
        askedAt,
      );
    });
    const underWay = { answer, askedAt, needs };
    for (const id of ids) reading.set(id, underWay);
    return answer;
  }

  /**
   * Reads a repository's pages one after another, reporting each, until
   * they are done, one fails, or a later read supersedes this one. Only a
   * read of its open issues counts them, for the sidebar.
   */
  async function readPages(
    repository: RepositoryAddress,
    state: IssueState,
    reads: Reads,
  ) {
    const thisRead = reads.latest;
    let after: string | undefined;
    /** Why GitHub left issues out of a page, if it did. */
    let leftOut: GitHubError | undefined;
    do {
      const cursor = after;
      const askedAt = clock();
      const result = await request(
        state === "open" ? "fetchOpenIssues" : "fetchClosedIssues",
        [repository, cursor],
        () => pagesUrgency(repository, state),
      );
      // What a superseded read brings is still as new as anything.
      if (result.ok) store.put(result.value.issues, askedAt);
      if (reads.latest !== thisRead) return;
      if (result.ok) {
        for (const issue of result.value.issues) {
          thisRead.issueIds.add(issue.id);
        }
        thisRead.closedIssueCount = result.value.closedIssueCount;
        after = result.value.nextPage;
        leftOut ??= result.value.incomplete;
        if (after === undefined) {
          thisRead.done = true;
          reads.complete = thisRead;
          // Once GitHub left issues out of a page, the pages after it are
          // still read, and what they list replaces what was read before,
          // but it is not all: the read is marked, and its count is not
          // the repository's. The repository itself stays readable.
          if (leftOut) {
            thisRead.problem = {
              kind: "error",
              message: `GitHub left out some ${state} issues: ${describeGitHubError(leftOut)}`,
            };
          } else if (state === "open") {
            openIssuesLoaded(
              repository,
              thisRead.issueIds.size,
              thisRead.startedAt,
            );
          }
        }
      } else {
        thisRead.problem = problemOf(result.error);
        issuesFailed(repository, thisRead.problem, thisRead.startedAt);
        // What GitHub no longer shows this account shows no more.
        if (thisRead.problem.kind === "unavailable") {
          reads.complete = undefined;
          thisRead.issueIds.clear();
        }
      }
      pageRead(repository, state);
    } while (after !== undefined && thisRead.problem === undefined);
  }

  return {
    issuesOf(repository, state) {
      const reads = repositories.get(readsKey(repository, state));
      if (!reads) return undefined;
      const { complete, latest } = reads;
      const shown = complete ?? latest;
      return {
        issueIds: shown.issueIds,
        closedIssueCount: shown.closedIssueCount,
        readAt: complete?.startedAt,
        reading: !latest.done && latest.problem === undefined,
        problem: latest.problem,
      };
    },
    loadIssues(repository, state, since) {
      const key = readsKey(repository, state);
      const known = repositories.get(key);
      if (
        known &&
        known.latest.problem === undefined &&
        atOrAfter(known.latest.startedAt, since)
      ) {
        return false;
      }
      const latest: Read = {
        startedAt: clock(),
        issueIds: new Set(),
        closedIssueCount: undefined,
        done: false,
        problem: undefined,
      };
      const reads: Reads = known ?? { complete: undefined, latest };
      reads.latest = latest;
      repositories.set(key, reads);
      void readPages(repository, state, reads);
      return true;
    },
    readIssues(ids, since, urgency) {
      const joined = new Set<ReadUnderWay>();
      const unread: string[] = [];
      for (const id of ids) {
        const underWay = reading.get(id);
        if (underWay && atOrAfter(underWay.askedAt, since))
          joined.add(underWay);
        else unread.push(id);
      }
      // A read joined is as urgent as the most urgent list waiting for it.
      for (const underWay of joined) underWay.needs.push(urgency);
      return [
        ...[...joined].map(({ answer }) => answer),
        ...inBatches(unread, issuesPerRequest).map((batch) =>
          read(batch, urgency),
        ),
      ];
    },
    isReading(id) {
      return reading.has(id);
    },
    renameRepository(from, to) {
      for (const state of issueStates) {
        const reads = repositories.get(readsKey(from, state));
        if (!reads || repositories.has(readsKey(to, state))) continue;
        repositories.delete(readsKey(from, state));
        repositories.set(readsKey(to, state), reads);
      }
    },
  };
}

/** Every state a repository's issues are read in. */
export const issueStates: readonly IssueState[] = ["open", "closed"];

/** Tells a repository's reads of its open and closed issues apart. */
function readsKey(repository: RepositoryAddress, state: IssueState): string {
  return `${state}:${repositoryKey(repository)}`;
}
