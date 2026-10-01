import type { RateLimitBudget, RateLimitPool } from "@verdandi/core/contract";
import { timeOf } from "./freshness";

/** Every pool, in the order the popover lists them. */
const pools: readonly RateLimitPool[] = ["graphql", "core", "search"];

const titles: Record<RateLimitPool, string> = {
  graphql: "GraphQL API",
  core: "REST API",
  search: "Search",
};

/** What each pool is spent on, and how often it refills. */
const purposes: Record<RateLimitPool, string> = {
  graphql: "Lists, issue pages and the sidebar · refills hourly",
  core: "Other reads · refills hourly",
  search: "Views · refills every minute",
};

/** Below this share of its budget, a pool is low, as the core holds it. */
const lowShare = 0.1;

/** Whether the pool has filled up again since GitHub last said. */
function hasReset(budget: RateLimitBudget, now: number): boolean {
  return budget.resetAt <= now;
}

/** The share of a pool's budget left, from 0 to 1: all of it once it has reset. */
export function shareLeft(budget: RateLimitBudget, now: number): number {
  if (hasReset(budget, now)) return 1;
  if (budget.limit <= 0) return 0;
  return Math.min(Math.max(budget.remaining / budget.limit, 0), 1);
}

/** Whether less than a tenth of a pool's budget is left. */
export function isLow(budget: RateLimitBudget, now: number): boolean {
  return shareLeft(budget, now) < lowShare;
}

/** How a pool's budget stands, for its colour. */
export type BudgetTone = "normal" | "low" | "used-up";

function toneOf(budget: RateLimitBudget, now: number): BudgetTone {
  if (budget.remaining === 0 && !hasReset(budget, now)) return "used-up";
  return isLow(budget, now) ? "low" : "normal";
}

/** What the rate-limit button shows of every pool. */
export interface BudgetGauge {
  /**
   * Where its needle stands, from 0 to 1: about where the emptiest pool's
   * share left does, in five steps, and at two thirds before GitHub has said
   * anything of any pool.
   */
  needle: number;
  /** Whether a pool is low, for the button to say so. */
  low: boolean;
  /** Its tooltip. */
  title: string;
  /** What it says of the budgets to assistive technology. */
  description: string;
}

export function budgetGauge(
  budgets: readonly RateLimitBudget[],
  now: number,
): BudgetGauge {
  const shares = budgets.map((budget) => shareLeft(budget, now));
  const low = budgets.some((budget) => isLow(budget, now));
  const lowest = shares.length > 0 ? Math.min(...shares) : undefined;
  return {
    needle: lowest === undefined ? 2 / 3 : needleStep(lowest),
    low,
    title: low ? "A GitHub rate limit is running low" : "GitHub rate limits",
    description:
      lowest === undefined
        ? "Not used yet"
        : `${String(Math.round(lowest * 100))} percent left in the emptiest pool`,
  };
}

function needleStep(share: number): number {
  if (share < 0.17) return 0;
  if (share < 0.42) return 1 / 3;
  if (share < 0.59) return 1 / 2;
  if (share < 0.84) return 2 / 3;
  return 1;
}

/** One pool as the popover lists it. */
export interface PoolRow {
  pool: RateLimitPool;
  title: string;
  /** What is known of its budget, until GitHub has said anything of it. */
  budget:
    | {
        /** How much is left of how much, e.g. "4,620 of 5,000". */
        left: string;
        /** The share left, from 0 to 1, for its bar. */
        share: number;
        tone: BudgetTone;
        /** When it refills, e.g. "Refills in 38 minutes, at 14:40". */
        refill: string;
      }
    | undefined;
  /** What it is spent on, e.g. "Not used yet · Views · refills every minute". */
  unused: string;
}

/** Every pool as the popover lists it, in order, whether used yet or not. */
export function poolRows(
  budgets: readonly RateLimitBudget[],
  now: number,
): PoolRow[] {
  return pools.map((pool) => {
    const budget = budgets.find((each) => each.pool === pool);
    return {
      pool,
      title: titles[pool],
      budget: budget && {
        left: leftText(budget, now),
        share: shareLeft(budget, now),
        tone: toneOf(budget, now),
        refill: refillText(budget, now),
      },
      unused: `Not used yet · ${purposes[pool]}`,
    };
  });
}

function leftText(budget: RateLimitBudget, now: number): string {
  const remaining = hasReset(budget, now) ? budget.limit : budget.remaining;
  return `${remaining.toLocaleString("en-US")} of ${budget.limit.toLocaleString("en-US")}`;
}

function refillText(budget: RateLimitBudget, now: number): string {
  const at = timeOf(budget.resetAt, now);
  if (hasReset(budget, now)) return `Full again since ${at}`;
  return `Refills in ${waitText(budget.resetAt - now)}, at ${at}`;
}

/** A wait, e.g. "less than a minute", "38 minutes" or "1 hour, 5 minutes". */
function waitText(milliseconds: number): string {
  if (milliseconds < 60 * 1000) return "less than a minute";
  const total = Math.round(milliseconds / (60 * 1000));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const parts = [
    ...(hours > 0 ? [counted(hours, "hour")] : []),
    ...(minutes > 0 ? [counted(minutes, "minute")] : []),
  ];
  return parts.join(", ");
}

function counted(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? "" : "s"}`;
}
