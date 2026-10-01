import { describe, expect, it } from "vitest";
import type { ViewList } from "@verdandi/core/contract";
import { matchesLabel, viewStrips } from "./view-screen";

it("counts a view's matches as GitHub does", () => {
  expect(matchesLabel({ matchCount: 7, pullRequests: 0 }, 7)).toBe("7 matches");
  expect(matchesLabel({ matchCount: 1, pullRequests: 0 }, 1)).toBe("1 match");
  expect(matchesLabel({ matchCount: 0, pullRequests: 0 }, 0)).toBe("0 matches");
});

it("says how many are shown when fewer are listed than GitHub counts", () => {
  expect(matchesLabel({ matchCount: 4213, pullRequests: 0 }, 100)).toBe(
    "100 of 4,213 matches shown",
  );
});

it("names the pull requests a search also matches, which are not listed", () => {
  expect(matchesLabel({ matchCount: 7, pullRequests: 2 }, 5)).toBe(
    "7 matches · 2 pull requests not listed",
  );
  expect(matchesLabel({ matchCount: 1101, pullRequests: 30 }, 70)).toBe(
    "70 of 1,101 matches shown · 30 pull requests not listed",
  );
  expect(matchesLabel({ matchCount: 3, pullRequests: 1 }, 2)).toBe(
    "3 matches · 1 pull request not listed",
  );
});

describe("a view's strips", () => {
  function list(changes: Partial<ViewList>): ViewList {
    return {
      view: { id: "v", name: "Bugs", query: "label:bug" },
      labelFilter: [],
      trees: [],
      matchesShown: 7,
      inScope: 7,
      readingContext: false,
      matchCount: 7,
      pullRequests: 0,
      complete: true,
      incomplete: false,
      searching: undefined,
      searchProblem: undefined,
      loading: { status: "current", updatedAt: 0 },
      ...changes,
    };
  }

  it("shows none while the search results are complete", () => {
    expect(viewStrips(list({}))).toEqual([]);
  });

  it("asks to narrow a search beyond the 1,000-match ceiling, naming what decides which 1,000", () => {
    // A label filter narrows what is listed, not what the search returned.
    const limited = {
      matchCount: 4209,
      inScope: 1000,
      matchesShown: 12,
      labelFilter: [{ name: "ui", color: "0e8a16" }],
      complete: false,
    };

    expect(viewStrips(list(limited))).toEqual([
      {
        text: "1,000 of 4,209 matches shown · narrow the search",
        hint: "without sort: in the search, GitHub returns the newest-created 1,000; context issues may match too",
        retry: false,
      },
    ]);
    expect(
      viewStrips(
        list({
          ...limited,
          view: { id: "v", name: "Bugs", query: "label:bug sort:updated-desc" },
        }),
      )[0]?.hint,
    ).toBe(
      "sort:updated-desc in the search decides which 1,000; context issues may match too",
    );
  });

  it("offers to retry a search GitHub did not answer in full", () => {
    expect(viewStrips(list({ incomplete: true, complete: false }))).toEqual([
      {
        text: "GitHub did not return all matches",
        hint: "context issues may match too",
        retry: true,
      },
    ]);
  });

  it("waits until the first run has read every page", () => {
    expect(
      viewStrips(
        list({
          matchCount: 4209,
          matchesShown: 100,
          inScope: 100,
          complete: false,
          loading: { status: "loading" },
        }),
      ),
    ).toEqual([]);
  });
});
