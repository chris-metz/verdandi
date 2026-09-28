import { expect, it } from "vitest";
import { matchesLabel } from "./view-screen";

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
