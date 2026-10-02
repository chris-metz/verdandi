/**
 * PROTOTYPE (tabs), throwaway: the issues opened while the window is open,
 * newest first, in memory only.
 */
import type { RepositoryAddress } from "@verdandi/core/contract";
import { useSyncExternalStore } from "react";
import type { IssueDestination } from "../issue-navigation";
import { linkTarget } from "../link-target";
import { repositoryLabel, type SidebarScope as Scope } from "../scope";

export interface RecentIssue {
  issue: IssueDestination;
  repository: RepositoryAddress | undefined;
  number: number | undefined;
  /** `owner/name#12`, or the reference as the list named it. */
  label: string;
}

const limit = 12;
let recents: RecentIssue[] = [];
const listeners = new Set<() => void>();

/** Puts an issue first, once. */
export function recordRecent(
  issue: IssueDestination,
  scope: Scope | undefined,
) {
  const page = issue.url === undefined ? undefined : linkTarget(issue.url);
  let repository: RepositoryAddress | undefined;
  let number: number | undefined;
  if (page?.kind === "issue") {
    repository = page.repository;
    number = page.number;
  } else if (scope?.kind === "repository" && issue.reference.startsWith("#")) {
    repository = scope.repository;
    number = Number(issue.reference.slice(1));
  }
  const label =
    repository && number !== undefined
      ? `${repositoryLabel(repository)}#${String(number)}`
      : issue.reference;
  recents = [
    { issue, repository, number, label },
    ...recents.filter((recent) => recent.issue.id !== issue.id),
  ].slice(0, limit);
  for (const listener of listeners) listener();
}

export function useRecents(): readonly RecentIssue[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => recents,
  );
}
