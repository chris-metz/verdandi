import { describe, expect, it } from "vitest";
import { navigateIssues } from "./issue-navigation";
import { copyPlace, rememberedPlace, rememberPlace } from "./list-places";

const parent = { id: "parent", reference: "acme/api#1", title: "Parent" };
const subIssue = { id: "sub", reference: "other/work#2", title: "Sub-issue" };

describe("issue page navigation", () => {
  it("steps back to each visit's cursor, expansion and scroll, then the list's place", () => {
    const scope = { kind: "all" } as const;
    rememberPlace(0, scope, { selectedId: "parent", scrollTop: 480 });
    let stack = navigateIssues([], { kind: "open", issue: parent });
    stack = navigateIssues(stack, {
      kind: "remember",
      place: { cursor: "sub", scrollTop: 720, expanded: ["sub"] },
    });
    stack = navigateIssues(stack, { kind: "open", issue: subIssue });
    expect(stack.at(-1)?.place).toEqual({
      cursor: "sub",
      scrollTop: 0,
      expanded: [],
    });

    stack = navigateIssues(stack, { kind: "back" });
    expect(stack.at(-1)).toEqual({
      issue: parent,
      place: { cursor: "sub", scrollTop: 720, expanded: ["sub"] },
    });
    stack = navigateIssues(stack, { kind: "back" });
    expect(stack).toEqual([]);
    expect(rememberedPlace(0, scope)).toEqual({
      selectedId: "parent",
      scrollTop: 480,
    });
  });

  it("keeps each tab's own place in a list it shows, as another tab on the same entry moves", () => {
    const scope = { kind: "all" } as const;
    rememberPlace(1, scope, { selectedId: "parent", scrollTop: 480 });
    copyPlace(1, 2, scope);
    rememberPlace(2, scope, { selectedId: "sub", scrollTop: 90 });
    expect(rememberedPlace(1, scope)).toEqual({
      selectedId: "parent",
      scrollTop: 480,
    });
    expect(rememberedPlace(2, scope)).toEqual({
      selectedId: "sub",
      scrollTop: 90,
    });
    expect(rememberedPlace(3, scope)).toEqual({
      selectedId: undefined,
      scrollTop: 0,
    });
  });
});

it("returns straight to the list from any depth and starts repeat visits fresh", () => {
  let stack = navigateIssues([], { kind: "open", issue: parent });
  stack = navigateIssues(stack, { kind: "open", issue: subIssue });
  stack = navigateIssues(stack, { kind: "open", issue: parent });
  expect(stack.map(({ issue }) => issue.id)).toEqual([
    "parent",
    "sub",
    "parent",
  ]);
  expect(navigateIssues(stack, { kind: "list" })).toEqual([]);
  expect(navigateIssues(stack, { kind: "open", issue: parent })).toHaveLength(
    3,
  );
});
