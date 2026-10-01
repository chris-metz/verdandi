import type { Problem, RepositoryAddress } from "./contract.ts";
import type { GitHubResult, Issue, IssueReference } from "./github/port.ts";
import { atOrAfter, type Moment } from "./moments.ts";
import { problemOf } from "./problems.ts";
import { sameRepository } from "./repository-address.ts";
import type { RequestResult } from "./request-queue.ts";

/**
 * The one in-memory store of issues read from GitHub, keyed by node ID, so an
 * issue is held once however many lists show it, and a re-read issue updates
 * wherever it appears. It also keeps why the latest read of an issue failed.
 * It lives until quit and is never persisted.
 */
export interface IssueStore {
  /**
   * Keeps issues just read, replacing earlier reads of the same issues, with
   * when GitHub was asked for them.
   */
  put(issues: readonly Issue[], askedAt: Moment): void;
  /**
   * Keeps why issues could not be read, with when GitHub was asked, unless
   * it was asked again since. An issue GitHub would not show to this account
   * is forgotten, so that nothing shows what the account may no longer read;
   * any other failure keeps what was read before.
   */
  fail(ids: readonly string[], problem: Problem, askedAt: Moment): void;
  /** An issue read earlier in this session, unless GitHub no longer shows it. */
  get(id: string): Issue | undefined;
  /** When GitHub was last asked for an issue that it returned. */
  readAt(id: string): Moment | undefined;
  /** Why the latest read of an issue failed, if it failed after the last one that did not. */
  failure(id: string): Failure | undefined;
  /**
   * Moves the issues read of a repository, and those naming its issues, to
   * its new address, as it was renamed or transferred.
   */
  renameRepository(from: RepositoryAddress, to: RepositoryAddress): void;
}

/** Why reading an issue failed, and when GitHub was asked. */
export interface Failure {
  problem: Problem;
  at: Moment;
}

interface Entry {
  read: { issue: Issue; at: Moment } | undefined;
  failure: Failure | undefined;
}

export function createIssueStore(): IssueStore {
  const entries = new Map<string, Entry>();

  function entry(id: string): Entry {
    let known = entries.get(id);
    if (!known) {
      known = { read: undefined, failure: undefined };
      entries.set(id, known);
    }
    return known;
  }

  return {
    put(read, askedAt) {
      for (const issue of read) {
        const known = entry(issue.id);
        // An answer to an earlier question does not undo a later failure,
        // least of all GitHub no longer showing the issue.
        const failedSince =
          known.failure && !atOrAfter(askedAt, known.failure.at);
        if (failedSince && known.failure?.problem.kind === "unavailable") {
          continue;
        }
        known.read = { issue, at: askedAt };
        if (!failedSince) known.failure = undefined;
      }
    },
    fail(ids, problem, askedAt) {
      for (const id of ids) {
        const known = entry(id);
        if (known.read && atOrAfter(known.read.at, askedAt)) continue;
        if (known.failure && atOrAfter(known.failure.at, askedAt)) continue;
        known.failure = { problem, at: askedAt };
        if (problem.kind === "unavailable") known.read = undefined;
      }
    },
    get(id) {
      return entries.get(id)?.read?.issue;
    },
    readAt(id) {
      return entries.get(id)?.read?.at;
    },
    failure(id) {
      return entries.get(id)?.failure;
    },
    renameRepository(from, to) {
      const moved = <T extends Pick<IssueReference, "repository">>(
        issue: T,
      ): T =>
        sameRepository(issue.repository, from)
          ? { ...issue, repository: { ...to } }
          : issue;
      for (const known of entries.values()) {
        if (!known.read) continue;
        const { issue } = known.read;
        known.read = {
          ...known.read,
          issue: {
            ...moved(issue),
            parent: issue.parent && moved(issue.parent),
            subIssues: issue.subIssues.map(moved),
          },
        };
      }
    },
  };
}

/**
 * Keeps GitHub's answer to a read of issues by ID: each issue it returned,
 * and why it did not return the others, or why the whole read failed.
 */
export function keepAnswer(
  store: IssueStore,
  ids: readonly string[],
  answer: RequestResult<GitHubResult<Issue>[]>,
  askedAt: Moment,
) {
  if (!answer.ok) {
    store.fail(ids, problemOf(answer.error), askedAt);
    return;
  }
  for (const [index, id] of ids.entries()) {
    const issue = answer.value[index];
    if (issue?.ok) store.put([issue.value], askedAt);
    else {
      const error = issue?.error ?? { kind: "unexpected-response" };
      store.fail([id], problemOf(error), askedAt);
    }
  }
}
