import type { RateLimitBudget, RateLimitPool } from "@verdandi/core/contract";
import { Popover } from "@base-ui/react/popover";
import {
  ArrowLeftRight,
  Search,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  budgetGauge,
  poolRows,
  type BudgetTone,
  type PoolRow,
} from "./rate-limit-budgets";
import { useNow } from "./use-now";

const icons: Record<RateLimitPool, LucideIcon> = {
  graphql: Waypoints,
  core: ArrowLeftRight,
  search: Search,
};

const bars: Record<BudgetTone, string> = {
  normal: "bg-primary",
  low: "bg-warning",
  "used-up": "bg-destructive",
};

/**
 * The button beside the account that shows how much of GitHub's rate limits
 * is left: a gauge whose needle drops with the emptiest pool, in the warning
 * colour and pulsing once one runs low. It opens a popover with every pool.
 */
export function RateLimitsButton({ login }: { login: string }) {
  const budgets = useRateLimitBudgets();
  const gauge = budgetGauge(budgets, useNow());
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label="Rate Limits"
        aria-description={gauge.description}
        title={gauge.title}
        className={cn(
          "-my-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground data-popup-open:bg-sidebar-accent data-popup-open:text-foreground",
          gauge.low &&
            "text-warning hover:text-warning motion-safe:animate-pulse",
        )}
      >
        <GaugeIcon needle={gauge.needle} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="end"
          sideOffset={6}
          className="z-50"
        >
          <Popover.Popup
            aria-label="GitHub Rate Limits"
            className="w-80 rounded-lg border bg-popover p-4 text-popover-foreground shadow-md outline-none"
          >
            <RateLimitsPopup budgets={budgets} login={login} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Every pool's budget: how much is left of how much, and when it refills. */
function RateLimitsPopup({
  budgets,
  login,
}: {
  budgets: readonly RateLimitBudget[];
  login: string;
}) {
  const rows = poolRows(budgets, useTicking(15 * 1000));
  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-0.5">
        <h2 className="text-sm font-semibold">GitHub Rate Limits</h2>
        <p className="text-xs text-muted-foreground">
          What is left for @{login}, as GitHub last said.
        </p>
      </div>
      {rows.map((row) => (
        <PoolBudget key={row.pool} row={row} />
      ))}
    </div>
  );
}

function PoolBudget({ row }: { row: PoolRow }) {
  const Icon = icons[row.pool];
  const { budget } = row;
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex items-center gap-2">
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">{row.title}</span>
        {budget && budget.tone !== "normal" && (
          <span
            className={cn(
              "rounded-full px-1.5 text-[10px] leading-4 font-semibold text-white",
              budget.tone === "used-up" ? "bg-destructive" : "bg-warning",
            )}
          >
            {budget.tone === "used-up" ? "Used Up" : "Low"}
          </span>
        )}
        {budget && (
          <span className="ml-auto text-muted-foreground tabular-nums">
            {budget.left}
          </span>
        )}
      </div>
      {budget ? (
        <>
          <div
            aria-hidden
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              style={{ width: `${String(budget.share * 100)}%` }}
              className={cn("h-full rounded-full", bars[budget.tone])}
            />
          </div>
          <p className="text-xs text-muted-foreground">{budget.refill}</p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground/70">{row.unused}</p>
      )}
    </div>
  );
}

/**
 * A gauge's dial with its needle standing at a share of it, from 0 at the
 * lower left to 1 at the lower right, drawn as Lucide's icons are.
 */
function GaugeIcon({ needle }: { needle: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
      <path
        d="M12 14V8.5"
        transform={`rotate(${String(needle * 240 - 120)} 12 14)`}
      />
    </svg>
  );
}

/** Every pool's budget as the core last read or pushed it. */
function useRateLimitBudgets(): RateLimitBudget[] {
  const [budgets, setBudgets] = useState<RateLimitBudget[]>([]);
  useEffect(() => {
    let current = true;
    // A push is newer than the answer to a read that started before it.
    let pushed = false;
    const unsubscribe = window.verdandi.on(
      "rateLimitBudgetsChanged",
      (changed) => {
        pushed = true;
        setBudgets(changed);
      },
    );
    void window.verdandi.getRateLimitBudgets().then((read) => {
      if (current && !pushed) setBudgets(read);
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, []);
  return budgets;
}

/** The time, brought up to date this often while the component shows. */
function useTicking(interval: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, interval);
    return () => {
      clearInterval(timer);
    };
  }, [interval]);
  return now;
}
