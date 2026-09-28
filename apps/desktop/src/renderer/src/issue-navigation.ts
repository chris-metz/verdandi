import type { ParentIssue } from "@verdandi/core/contract";

/**
 * Enough to name a destination before its page has loaded, and its page on
 * GitHub when the place it was opened from knows it.
 */
export type IssueDestination = Pick<
  ParentIssue,
  "id" | "reference" | "title"
> & { url?: string };

/** The place in one visit, independent of other visits to the same issue. */
export interface IssuePlace {
  cursor: string;
  scrollTop: number;
  expanded: string[];
}

export interface IssueVisit {
  issue: IssueDestination;
  place: IssuePlace;
}

export type IssueNavigation =
  | { kind: "open"; issue: IssueDestination }
  | { kind: "back" }
  | { kind: "list" }
  | { kind: "remember"; place: IssuePlace };

/** The empty stack shows the list; the last visit is the current page. */
export function navigateIssues(
  stack: readonly IssueVisit[],
  action: IssueNavigation,
): IssueVisit[] {
  switch (action.kind) {
    case "open":
      if (stack.at(-1)?.issue.id === action.issue.id) return [...stack];
      return [
        ...stack,
        {
          issue: action.issue,
          place: { cursor: action.issue.id, scrollTop: 0, expanded: [] },
        },
      ];
    case "back":
      return stack.slice(0, -1);
    case "list":
      return [];
    case "remember":
      return stack.map((visit, index) =>
        index === stack.length - 1 ? { ...visit, place: action.place } : visit,
      );
  }
}
