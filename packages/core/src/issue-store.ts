import type { Issue } from "./github/port.ts";

/**
 * The one in-memory store of issues read from GitHub, keyed by node ID, so an
 * issue is held once however many lists show it. It lives until quit and is
 * never persisted.
 */
export interface IssueStore {
  /** Keeps issues just read, replacing earlier reads of the same issues. */
  put(issues: readonly Issue[]): void;
  /** An issue read earlier in this session. */
  get(id: string): Issue | undefined;
}

export function createIssueStore(): IssueStore {
  const issues = new Map<string, Issue>();
  return {
    put(read) {
      for (const issue of read) issues.set(issue.id, issue);
    },
    get(id) {
      return issues.get(id);
    },
  };
}
