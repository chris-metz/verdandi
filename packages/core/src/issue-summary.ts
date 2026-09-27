import type { IssueSummary } from "./contract.ts";
import type { Issue } from "./github/port.ts";

/** The common facts shown in outline rows and on issue pages. */
export function summarizeIssue(
  issue: Issue,
  presentation: {
    reference: string;
    external: boolean;
  },
): IssueSummary {
  const { blockedBy, totalBlockedBy, blocking, totalBlocking } =
    issue.issueDependenciesSummary;
  return {
    id: issue.id,
    repository: issue.repository,
    ...presentation,
    title: issue.title,
    state: issue.state,
    url: issue.url,
    labels: issue.labels,
    subIssueProgress: {
      closed: issue.subIssuesSummary.completed,
      total: issue.subIssuesSummary.total,
    },
    blockedBy: { open: blockedBy, total: totalBlockedBy },
    blocking: { open: blocking, total: totalBlocking },
  };
}
