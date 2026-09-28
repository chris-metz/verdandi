import type { RepositoryAddress } from "@verdandi/core/contract";
import {
  describeViewScope,
  type ViewScopeTarget,
} from "@verdandi/core/view-scope";
import { repositoryLabel } from "./scope";

/** A search the view dialog suggests, with a name for the view and what it finds. */
export interface ViewExample {
  name: string;
  query: string;
  description: string;
}

/**
 * The searches the view dialog suggests, naming the first tracked
 * repositories where a search names one, or placeholders while none is
 * tracked.
 */
export function viewExamples(
  tracked: readonly RepositoryAddress[],
): ViewExample[] {
  const [first = { owner: "owner", name: "repo" }, second] = tracked;
  const other = second ?? { owner: first.owner, name: "other" };
  const one = repositoryLabel(first);
  const two = repositoryLabel(other);
  return [
    {
      name: "Assigned to me",
      query: "is:open assignee:@me",
      description: "Open issues assigned to you, in any repository",
    },
    {
      name: `Open in ${first.name}`,
      query: `repo:${one} is:open`,
      description: "Open issues in one repository",
    },
    {
      name: `${first.name} and ${other.name}`,
      query: `(repo:${one} OR repo:${two}) is:open`,
      description: "Several repositories need OR",
    },
    {
      name: `Blocked in ${first.owner}`,
      query: `org:${first.owner} is:open is:blocked`,
      description: "Open issues with an open blocker, in one organization",
    },
    {
      name: "Parent issues",
      query: "is:open has:sub-issue",
      description: "Issues that have sub-issues",
    },
    {
      name: `Sub-issues of ${first.name}#1`,
      query: `parent-issue:${one}#1`,
      description: "The sub-issues of one issue",
    },
    {
      name: "Unassigned bugs",
      query: "is:open label:bug no:assignee sort:updated-desc",
      description: "sort: decides which 1,000 load when there are more",
    },
  ];
}

/**
 * The dialog's fields once an example is clicked: its search replaces the
 * search, and its name fills the name if it is empty, or still the name of
 * the offered example whose search it replaces.
 */
export function applyExample(
  draft: { name: string; query: string },
  example: ViewExample,
  offered: readonly ViewExample[],
): { name: string; query: string } {
  const named =
    draft.name.trim() === "" ||
    offered.some(
      ({ name, query }) => name === draft.name && query === draft.query,
    );
  return { name: named ? example.name : draft.name, query: example.query };
}

/**
 * The line under the search saying what it covers, from its `repo:`,
 * `org:` and `user:` qualifiers alone, and a warning when it combines
 * repositories so that it matches nothing.
 */
export function scopeLine(query: string): {
  text: string;
  warning: string | undefined;
} {
  const { covers, warning } = describeViewScope(query);
  return {
    text:
      covers.kind === "everywhere"
        ? "Searches every repository you can read on GitHub, tracked or not."
        : `Searches only ${listed(covers.targets.map(targetName))}. Adding or removing tracked repositories never changes that.`,
    warning:
      warning &&
      `Several repo: qualifiers without OR must all hold at once, so this matches nothing. Join them with OR: (${warning.repositories.map((name) => `repo:${name}`).join(" OR ")}).`,
  };
}

function targetName(target: ViewScopeTarget): string {
  return target.kind === "repository"
    ? target.name
    : `${target.login}'s repositories`;
}

/** Names joined as a sentence would: "a, b or c". */
function listed(names: string[]): string {
  const last = names.at(-1) ?? "";
  return names.length < 2
    ? last
    : `${names.slice(0, -1).join(", ")} or ${last}`;
}
