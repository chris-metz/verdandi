import type { IssueNode, IssueTree } from "@verdandi/core/contract";
import { describe, expect, it } from "vitest";
import { afterLookUp, beforeLookUp, issueNumber } from "./go-to-issue";
import type { IssueDestination } from "./issue-navigation";

describe("reading the Go to issue field", () => {
  it("takes a number", () => {
    expect(issueNumber("123")).toBe(123);
    expect(issueNumber(" 7 ")).toBe(7);
  });

  it("ignores a leading #", () => {
    expect(issueNumber("#123")).toBe(123);
  });

  it.each(["", "#", "abc", "12a", "1.5", "-3", "0", "##12", "acme/api#12"])(
    "takes nothing else: %j",
    (text) => {
      expect(issueNumber(text)).toBeUndefined();
    },
  );

  it("takes no number GitHub could not have", () => {
    expect(issueNumber("2147483647")).toBe(2147483647);
    expect(issueNumber("2147483648")).toBeUndefined();
  });
});

/** An issue as `acme/api`'s list names it, with its sub-issues. */
function issue(
  reference: string,
  subIssues: IssueNode[] = [],
  expanded = true,
): IssueNode {
  const [, repository = "acme/api", number = ""] =
    /^([\w.-]+\/[\w.-]+)?#(\d+)$/.exec(reference) ?? [];
  const [owner = "", name = ""] = repository.split("/");
  return {
    issue: {
      id: `I_${repository}#${number}`,
      repository: { owner, name },
      reference,
      title: `Issue ${reference}`,
      state: "open",
      url: `https://github.com/${repository}/issues/${number}`,
      author: undefined,
      createdAt: "2026-09-01T12:00:00Z",
      labels: [],
      external: repository !== "acme/api",
      subIssueProgress: { closed: 0, total: subIssues.length },
      blockedBy: { open: 0, total: 0 },
      blocking: { open: 0, total: 0 },
      incomplete: undefined,
    },
    subIssues,
    expanded,
  };
}

function tree(node: IssueNode): IssueTree {
  return { ...node, parent: undefined };
}

describe("before asking GitHub", () => {
  /** #1 with #2 and other/lib#5 below it, then #6 with #7, collapsed. */
  const trees = [
    tree(issue("#1", [issue("#2"), issue("other/lib#5")])),
    tree(issue("#6", [issue("#7")], false)),
  ];

  /** What ↵ does with a number in `acme/api`, with an issue page shown or not. */
  function before(number: number, shown?: IssueDestination) {
    return beforeLookUp(number, {
      repository: { owner: "acme", name: "api" },
      shown,
      trees,
    });
  }

  it("opens an issue the repository's list has, at any depth, collapsed away or not", () => {
    expect(before(1)).toEqual({
      kind: "open",
      issue: {
        id: "I_acme/api#1",
        reference: "#1",
        title: "Issue #1",
        url: "https://github.com/acme/api/issues/1",
      },
    });
    expect(before(2)).toMatchObject({
      kind: "open",
      issue: { id: "I_acme/api#2" },
    });
    expect(before(7)).toMatchObject({
      kind: "open",
      issue: { id: "I_acme/api#7" },
    });
  });

  it("looks up an issue the list does not have, even when another repository's has its number", () => {
    expect(before(3)).toEqual({ kind: "look-up" });
    expect(before(5)).toEqual({ kind: "look-up" });
  });

  it("just closes for the issue already shown, known by its page, whether the list has it or not", () => {
    const shown = {
      id: "I_acme/api#3",
      reference: "acme/api#3",
      title: "Closed long ago",
      url: "https://github.com/Acme/API/issues/3",
    };
    expect(before(3, shown)).toEqual({ kind: "shown" });
    expect(before(4, shown)).toEqual({ kind: "look-up" });
  });

  it("just closes for the issue already shown that the list has, known by its ID", () => {
    const shown = { id: "I_acme/api#2", reference: "#2", title: "Issue #2" };
    expect(before(2, shown)).toEqual({ kind: "shown" });
  });

  it("does not take an external issue shown for the repository's issue with its number", () => {
    const shown = {
      id: "I_other/lib#5",
      reference: "other/lib#5",
      title: "Issue other/lib#5",
      url: "https://github.com/other/lib/issues/5",
    };
    expect(before(5, shown)).toEqual({ kind: "look-up" });
  });
});

describe("what GitHub's answer does", () => {
  it("opens an issue it found", () => {
    const issue = {
      id: "I_12",
      reference: "acme/api#12",
      title: "Crash on start",
      url: "https://github.com/acme/api/issues/12",
    };
    expect(afterLookUp({ status: "found", issue }, 12)).toEqual({
      kind: "open",
      issue,
    });
  });

  it("says the number is a pull request, with its page to open", () => {
    const url = "https://github.com/acme/api/pull/123";
    expect(afterLookUp({ status: "pull-request", url }, 123)).toEqual({
      kind: "pull-request",
      number: 123,
      url,
    });
  });

  it("says why the issue could not be opened", () => {
    const problem = { kind: "unreachable", message: "offline" } as const;
    expect(afterLookUp({ status: "failed", problem }, 12)).toEqual({
      kind: "failed",
      problem,
    });
  });

  it("says nothing when the lookup was dropped, e.g. for another account, so that Enter asks again", () => {
    expect(
      afterLookUp({ status: "failed", problem: { kind: "interrupted" } }, 12),
    ).toEqual({ kind: "idle" });
  });
});
