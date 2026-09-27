import type { Issue } from "./github/port.ts";
import type { Moment } from "./moments.ts";

/**
 * The one in-memory store of issues read from GitHub, keyed by node ID, so an
 * issue is held once however many lists show it, and a re-read issue updates
 * wherever it appears. It lives until quit and is never persisted.
 */
export interface IssueStore {
  /**
   * Keeps issues just read, replacing earlier reads of the same issues, with
   * when GitHub was asked for them.
   */
  put(issues: readonly Issue[], askedAt: Moment): void;
  /** An issue read earlier in this session. */
  get(id: string): Issue | undefined;
  /** When GitHub was last asked for an issue that it returned. */
  readAt(id: string): Moment | undefined;
}

export function createIssueStore(): IssueStore {
  const issues = new Map<string, { issue: Issue; readAt: Moment }>();
  return {
    put(read, askedAt) {
      for (const issue of read)
        issues.set(issue.id, { issue, readAt: askedAt });
    },
    get(id) {
      return issues.get(id)?.issue;
    },
    readAt(id) {
      return issues.get(id)?.readAt;
    },
  };
}
