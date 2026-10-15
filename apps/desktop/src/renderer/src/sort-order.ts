import type { IssueState, SortOrder } from "@verdandi/core/contract";

/** The sort orders a list's menu offers, in its order. */
export const sortOrders: readonly SortOrder[] = ["newest", "updated"];

/** Which date a list's date column shows. */
export type ListDate = "created" | "closed" | "updated";

/** A sort order's name, by the date it goes by. */
const names: Record<ListDate, string> = {
  created: "Newest",
  closed: "Recently closed",
  updated: "Recently updated",
};

/** A sort order's name in a list in a state. */
export function sortOrderName(order: SortOrder, state: IssueState): string {
  return names[listDate(order, state)];
}

/**
 * The date a list in a state goes by in a sort order, which its date column
 * shows: when each issue was opened, closed or last updated.
 */
export function listDate(order: SortOrder, state: IssueState): ListDate {
  if (order === "updated") return "updated";
  return state === "closed" ? "closed" : "created";
}
