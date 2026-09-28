import { expect, it } from "vitest";
import { rateLimitText } from "./rate-limit-text";

/** 14:32 on the machine's clock, wherever it is. */
const now = new Date(2026, 8, 27, 14, 32).getTime();
/** 14:37, five minutes later. */
const at1437 = new Date(2026, 8, 27, 14, 37).getTime();

it("says nothing while no pool holds requests back", () => {
  expect(rateLimitText([], now)).toBeUndefined();
});

it("says until when requests are paused once GitHub's rate limit is reached", () => {
  expect(
    rateLimitText([{ pool: "graphql", status: "paused", until: at1437 }], now),
  ).toBe("GitHub rate limit reached · requests paused until 14:37");
});

it("names the search limit apart", () => {
  expect(
    rateLimitText([{ pool: "search", status: "paused", until: at1437 }], now),
  ).toBe("GitHub search limit reached · requests paused until 14:37");
});

it("says until when nothing is refreshed on its own while the budget is low", () => {
  expect(
    rateLimitText([{ pool: "graphql", status: "low", until: at1437 }], now),
  ).toBe("GitHub rate limit low · automatic refresh off until 14:37");
});

it("names the date of a time on another day", () => {
  const tomorrow = new Date(2026, 8, 28, 0, 5).getTime();
  expect(
    rateLimitText([{ pool: "core", status: "paused", until: tomorrow }], now),
  ).toBe("GitHub rate limit reached · requests paused until Sep 28, 00:05");
});

it("says what holds back each pool, once for pools held back alike", () => {
  expect(
    rateLimitText(
      [
        { pool: "graphql", status: "paused", until: at1437 },
        { pool: "core", status: "paused", until: at1437 },
        { pool: "search", status: "low", until: at1437 },
      ],
      now,
    ),
  ).toBe(
    "GitHub rate limit reached · requests paused until 14:37 · GitHub search limit low · automatic refresh off until 14:37",
  );
});
