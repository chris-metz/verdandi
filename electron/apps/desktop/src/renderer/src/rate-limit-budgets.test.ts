import type { RateLimitBudget } from "@verdandi/core/contract";
import { describe, expect, it } from "vitest";
import { budgetGauge, poolRows } from "./rate-limit-budgets";

/** 14:02 on the machine's clock, wherever it is. */
const now = new Date(2026, 8, 27, 14, 2).getTime();
const minute = 60 * 1000;

/** The GraphQL pool with this much of 5,000 left, refilling at 14:40. */
function graphql(remaining: number, resetAt = now + 38 * minute) {
  return { pool: "graphql", limit: 5000, remaining, resetAt } as const;
}

describe("the button's gauge", () => {
  it("stands at two thirds and says so before GitHub has said anything", () => {
    expect(budgetGauge([], now)).toEqual({
      needle: 2 / 3,
      low: false,
      title: "GitHub rate limits",
      description: "Not used yet",
    });
  });

  it.each([
    [5000, 1],
    [4200, 1],
    [4199, 2 / 3],
    [2950, 2 / 3],
    [2949, 1 / 2],
    [2100, 1 / 2],
    [2099, 1 / 3],
    [850, 1 / 3],
    [849, 0],
    [0, 0],
  ])("stands in steps with the share left: %i of 5,000", (remaining, step) => {
    expect(budgetGauge([graphql(remaining)], now).needle).toBe(step);
  });

  it("follows the emptiest pool", () => {
    const search = {
      pool: "search",
      limit: 30,
      remaining: 9,
      resetAt: now + 41 * 1000,
    } as const;
    const gauge = budgetGauge([graphql(4620), search], now);

    expect(gauge.needle).toBe(1 / 3);
    expect(gauge.description).toBe("30 percent left in the emptiest pool");
  });

  it("says a pool is low below a tenth of its budget", () => {
    expect(budgetGauge([graphql(500)], now).low).toBe(false);
    expect(budgetGauge([graphql(499)], now)).toMatchObject({
      low: true,
      title: "A GitHub rate limit is running low",
    });
  });

  it("counts a pool as full once its reset has passed", () => {
    const gauge = budgetGauge([graphql(0, now - minute)], now);

    expect(gauge).toMatchObject({ needle: 1, low: false });
    expect(gauge.description).toBe("100 percent left in the emptiest pool");
  });
});

describe("the popover's rows", () => {
  it("lists every pool in order, saying what an unused one is spent on", () => {
    expect(poolRows([], now)).toEqual([
      {
        pool: "graphql",
        title: "GraphQL API",
        budget: undefined,
        unused:
          "Not used yet · Lists, issue pages and the sidebar · refills hourly",
      },
      {
        pool: "core",
        title: "REST API",
        budget: undefined,
        unused: "Not used yet · Other reads · refills hourly",
      },
      {
        pool: "search",
        title: "Search",
        budget: undefined,
        unused: "Not used yet · Views · refills every minute",
      },
    ]);
  });

  /** The GraphQL row of these budgets. */
  function graphqlRow(budget: RateLimitBudget) {
    return poolRows([budget], now)[0]?.budget;
  }

  it("says how much is left of how much, and when the pool refills", () => {
    expect(graphqlRow(graphql(4620))).toEqual({
      left: "4,620 of 5,000",
      share: 4620 / 5000,
      tone: "normal",
      refill: "Refills in 38 minutes, at 14:40",
    });
  });

  it("says low below a tenth, and used up at nothing left", () => {
    expect(graphqlRow(graphql(312))?.tone).toBe("low");
    expect(graphqlRow(graphql(0))).toMatchObject({ share: 0, tone: "used-up" });
  });

  it("shows a pool whose reset has passed as full again", () => {
    expect(graphqlRow(graphql(0, now - 2 * minute))).toEqual({
      left: "5,000 of 5,000",
      share: 1,
      tone: "normal",
      refill: "Full again since 14:00",
    });
  });

  it.each([
    [41 * 1000, "less than a minute"],
    [minute, "1 minute"],
    [60 * minute, "1 hour"],
    [61 * minute, "1 hour, 1 minute"],
    [125 * minute + 20 * 1000, "2 hours, 5 minutes"],
  ])("spells out a wait of %i ms as %s", (wait, text) => {
    expect(graphqlRow(graphql(4000, now + wait))?.refill).toMatch(
      new RegExp(`^Refills in ${text}, at `),
    );
  });

  it("names the date of a refill on another day", () => {
    const tomorrow = new Date(2026, 8, 28, 0, 5).getTime();

    expect(graphqlRow(graphql(4000, tomorrow))?.refill).toBe(
      "Refills in 10 hours, 3 minutes, at Sep 28, 00:05",
    );
  });
});
