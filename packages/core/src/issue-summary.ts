import type { IssueIdentity, IssueSummary } from "./contract.ts";
import type { Issue, IssueReference } from "./github/port.ts";
import { problemOf } from "./problems.ts";

/** How a list or page presents an issue wherever it shows it. */
interface Presentation {
  reference: string;
  external: boolean;
}

/**
 * What a relationship tells of an issue, for a list or page that has not
 * read it. Its page is where GitHub keeps every issue.
 */
export function identifyIssue(
  issue: IssueReference,
  presentation: Presentation,
): IssueIdentity {
  const { owner, name } = issue.repository;
  return {
    id: issue.id,
    repository: issue.repository,
    ...presentation,
    title: issue.title,
    state: issue.state,
    url: `https://github.com/${owner}/${name}/issues/${String(issue.number)}`,
  };
}

/** The common facts shown in outline rows and on issue pages. */
export function summarizeIssue(
  issue: Issue,
  presentation: Presentation,
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
    incomplete: issue.incomplete && problemOf(issue.incomplete),
  };
}
