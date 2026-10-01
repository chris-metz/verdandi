import { isDeepStrictEqual } from "node:util";
import type {
  RateLimitBudget,
  RateLimitPool,
  RateLimitState,
} from "./contract.ts";
import {
  rateLimitPools,
  type GitHubAccess,
  type GitHubError,
  type GitHubRead,
  type GitHubResponse,
  type ReadValue,
} from "./github/port.ts";

/**
 * How urgently a request is needed, from most to least urgent:
 *
 * - `visible`: for what the current screen shows;
 * - `rest`: for the rest of it, such as the sub-issues below collapsed
 *   issues;
 * - `background`: for the sidebar's counts, or to read the current screen
 *   again on its own because it has grown old.
 */
export type Urgency = "visible" | "rest" | "background";

/** The part of a screen a request is for: what it shows, or the rest. */
export type ScreenPart = Exclude<Urgency, "background">;

const ranks: Record<Urgency, number> = { visible: 0, rest: 1, background: 2 };

/** Whether one urgency is more urgent than another, or than none. */
function moreUrgent(urgency: Urgency, than: Urgency | undefined): boolean {
  return than === undefined || ranks[urgency] < ranks[than];
}

/** The most urgent of some urgencies, or none when nothing needs a request. */
export function mostUrgent(
  urgencies: Iterable<Urgency | undefined>,
): Urgency | undefined {
  let most: Urgency | undefined;
  for (const urgency of urgencies) {
    if (urgency && moreUrgent(urgency, most)) most = urgency;
  }
  return most;
}

/**
 * How urgently a screen needs a part of it: not at all once it is not on
 * screen, and in the background while it is read again on its own.
 */
export function screenUrgency(
  screen: { shown: boolean; background: boolean },
  part: ScreenPart,
): Urgency | undefined {
  if (!screen.shown) return undefined;
  return screen.background ? "background" : part;
}

/**
 * Why a request got no answer: GitHub's or gh's error, or it was dropped
 * unsent since nothing on screen needed it any more.
 */
export type RequestError = GitHubError | { kind: "interrupted" };

/** What a request sent through the queue comes to. */
export type RequestResult<T> =
  { ok: true; value: T } | { ok: false; error: RequestError };

/**
 * What a request comes to that was dropped, or whose answer was discarded:
 * nothing.
 */
export const interrupted = {
  ok: false,
  error: { kind: "interrupted" },
} as const satisfies RequestResult<never>;

/**
 * Sends one GitHub read through the core's request queue, which schedules
 * them all; the core's modules take this instead of the port itself. The
 * queue asks `urgency` whenever it picks what to send next: a request that
 * nothing needs any more by then is dropped, unsent, as interrupted. An
 * argument factory trims a shared batch to what is needed when it is sent.
 */
export type SendRequest = <R extends GitHubRead>(
  read: R,
  args: Parameters<GitHubAccess[R]> | (() => Parameters<GitHubAccess[R]>),
  urgency: () => Urgency | undefined,
) => Promise<RequestResult<ReadValue<R>>>;

/**
 * The one queue every GitHub read passes through. It sends the most urgent
 * first, a few at a time, and drops those nothing needs any more. It follows
 * each rate-limit pool's budget as GitHub's answers report it, and holds a
 * pool's requests back while GitHub's rate limit stops them: until the pool
 * resets once its budget is used up, or as long as GitHub asks after a
 * secondary limit. Requests held back go on on their own. It also keeps
 * each pool's budget as GitHub last reported it, for the user to look up,
 * still after the pool resets. Each request is
 * tagged with the account as it is sent, and what GitHub answers to one sent
 * as an earlier account is discarded.
 */
export interface RequestQueue {
  /**
   * Sends a read of a pool once it is the most urgent request waiting and
   * the pool lets it through, and answers with GitHub's answer, never with a
   * rate limit: a request GitHub rate-limits waits and is sent again.
   */
  run<T>(
    pool: RateLimitPool,
    urgency: () => Urgency | undefined,
    send: () => Promise<GitHubResponse<T>>,
  ): Promise<RequestResult<T>>;
  /** Drops the waiting requests that nothing needs any more. */
  sweep(): void;
  /**
   * Cancels every request as GitHub is read as another account: those
   * waiting are dropped unsent, and answer as interrupted, as do those under
   * way once GitHub answers. What GitHub reported of each pool's budget, and
   * any pause, are forgotten, since they were the previous account's.
   */
  cancel(): void;
  /**
   * Whether less than a tenth of a pool's budget is left until GitHub resets
   * it.
   */
  isLow(pool: RateLimitPool): boolean;
  /** Every pool that holds requests back, and how. */
  states(): RateLimitState[];
  /**
   * Each pool's budget as GitHub last reported it, still after the pool
   * resets, of the pools GitHub has answered for.
   */
  budgets(): RateLimitBudget[];
}

export interface RequestQueueOptions {
  /** At most this many requests are sent at once. */
  concurrency: number;
  /** The time, in milliseconds since the epoch. */
  now: () => number;
  /** Waits a number of milliseconds. */
  wait: (milliseconds: number) => Promise<void>;
  /** Takes every pool that holds requests back, whenever that changes. */
  push: (states: RateLimitState[]) => void;
  /** Takes each pool's budget as GitHub last reported it, as that changes. */
  pushBudgets: (budgets: RateLimitBudget[]) => void;
  /** The account GitHub is read as, by its tag. */
  account: () => number;
}

/** Below this share of its budget, a pool is low. */
const budgetFloor = 0.1;

/**
 * After a secondary rate limit that does not say how long to wait, a pool
 * waits this long, twice as long after each further one, up to the most.
 */
const firstBackoff = 60 * 1000;
const longestBackoff = 15 * 60 * 1000;

/** A request waiting to be sent, or under way. */
interface Entry {
  pool: RateLimitPool;
  urgency: () => Urgency | undefined;
  send: () => Promise<GitHubResponse<unknown>>;
  /** Counts up: among equally urgent requests, the first asked goes first. */
  order: number;
  /** How many requests had been sent when it was last sent, itself included. */
  sentAs: number;
  /** The tag of the account it was last sent as. */
  account: number;
  settle: (result: RequestResult<unknown>) => void;
  fail: (reason: unknown) => void;
}

/** What the queue knows of a pool. */
interface Pool {
  /** Its budget as GitHub last reported it, until GitHub resets the pool. */
  budget: RateLimitBudget | undefined;
  /** Until when its requests wait, while they do. */
  pausedUntil: number | undefined;
  /** How many requests had been sent when it last paused. */
  pausedAfter: number;
  /**
   * How many secondary rate limits it met in a row, without a request sent
   * since succeeding.
   */
  secondaryLimits: number;
  /** The reset a budget below the floor is followed to, if one is. */
  lowUntil: number | undefined;
  /** Its budget as GitHub last reported it, kept after the pool resets. */
  reported: RateLimitBudget | undefined;
}

export function createRequestQueue({
  concurrency,
  now,
  wait,
  push,
  pushBudgets,
  account,
}: RequestQueueOptions): RequestQueue {
  const waiting = new Set<Entry>();
  /**
   * What the queue knows of each pool, replaced as a whole on `cancel`, so
   * that the timers of the pools before change nothing.
   */
  let pools = freshPools();
  let running = 0;
  let order = 0;
  /** How many requests have been sent. */
  let sent = 0;
  /**
   * After a secondary rate limit, requests go one at a time until one sent
   * since succeeds: how many requests had been sent then, while they do.
   */
  let slowedAfter: number | undefined;
  let pushed: RateLimitState[] = [];
  let pushedBudgets: RateLimitBudget[] = [];

  function poolOf(name: RateLimitPool): Pool {
    const pool = pools.get(name);
    if (!pool) throw new Error(`Unknown rate-limit pool: ${name}`);
    return pool;
  }

  function isLow(name: RateLimitPool): boolean {
    const { budget } = poolOf(name);
    return (
      budget !== undefined &&
      budget.remaining < budget.limit * budgetFloor &&
      budget.resetAt > now()
    );
  }

  function states(): RateLimitState[] {
    return rateLimitPools.flatMap((name): RateLimitState[] => {
      const { pausedUntil, budget } = poolOf(name);
      if (pausedUntil !== undefined) {
        return [{ pool: name, status: "paused", until: pausedUntil }];
      }
      if (budget && isLow(name)) {
        return [{ pool: name, status: "low", until: budget.resetAt }];
      }
      return [];
    });
  }

  /** Pushes the pools' states, unless they are as last pushed. */
  function pushStates() {
    const current = states();
    if (isDeepStrictEqual(current, pushed)) return;
    pushed = current;
    push(current);
  }

  function budgets(): RateLimitBudget[] {
    return rateLimitPools.flatMap((name) => poolOf(name).reported ?? []);
  }

  /** Pushes the pools' budgets, unless they are as last pushed. */
  function pushReported() {
    const current = budgets();
    if (isDeepStrictEqual(current, pushedBudgets)) return;
    pushedBudgets = current;
    pushBudgets(current);
  }

  /** Drops a waiting request, unsent, which answers as interrupted. */
  function drop(entry: Entry) {
    waiting.delete(entry);
    entry.settle(interrupted);
  }

  /**
   * The most urgent request whose pool lets it through, dropping those that
   * nothing needs any more.
   */
  function next(): Entry | undefined {
    let best: { entry: Entry; urgency: Urgency } | undefined;
    for (const entry of waiting) {
      const urgency = entry.urgency();
      if (urgency === undefined) {
        drop(entry);
        continue;
      }
      if (poolOf(entry.pool).pausedUntil !== undefined) continue;
      if (
        !best ||
        moreUrgent(urgency, best.urgency) ||
        (urgency === best.urgency && entry.order < best.entry.order)
      ) {
        best = { entry, urgency };
      }
    }
    return best?.entry;
  }

  /** Sends the most urgent requests while there is room. */
  function pump() {
    while (running < (slowedAfter === undefined ? concurrency : 1)) {
      const entry = next();
      if (!entry) return;
      waiting.delete(entry);
      running++;
      entry.sentAs = ++sent;
      entry.account = account();
      entry.send().then(
        (response) => {
          answered(entry, response);
        },
        (reason: unknown) => {
          running--;
          entry.fail(reason);
          pump();
        },
      );
    }
  }

  /**
   * Takes GitHub's answer to a request: keeps the budget it reports, and
   * settles the request, unless GitHub rate-limited it, which then waits to
   * be sent again, pausing its pool. What GitHub answers to a request sent
   * before its pool last paused neither pauses it again nor ends what the
   * pause began, however it fares.
   */
  function answered(entry: Entry, response: GitHubResponse<unknown>) {
    running--;
    // Answered as an earlier account, it tells nothing of this one.
    if (entry.account !== account()) {
      entry.settle(interrupted);
      pump();
      return;
    }
    const pool = poolOf(entry.pool);
    const sentSincePause = entry.sentAs > pool.pausedAfter;
    if (response.budget) keepBudget(response.budget);
    if (!response.ok && response.error.kind === "rate-limited") {
      if (sentSincePause) pause(entry.pool, response.error, response.budget);
      waiting.add(entry);
    } else {
      if (response.ok && sentSincePause) pool.secondaryLimits = 0;
      if (
        response.ok &&
        slowedAfter !== undefined &&
        entry.sentAs > slowedAfter
      ) {
        slowedAfter = undefined;
      }
      entry.settle(response);
    }
    pushStates();
    pump();
  }

  /** Keeps a pool's budget, following it to its reset once it is low. */
  function keepBudget(budget: RateLimitBudget) {
    const pool = poolOf(budget.pool);
    pool.budget = budget;
    pool.reported = budget;
    pushReported();
    const { resetAt } = budget;
    if (!isLow(budget.pool) || pool.lowUntil === resetAt) return;
    pool.lowUntil = resetAt;
    void wait(resetAt - now()).then(() => {
      // GitHub has reset the pool since.
      if (pool.budget?.resetAt !== resetAt) return;
      pool.budget = undefined;
      pushStates();
    });
  }

  /**
   * Holds a pool's requests back after GitHub rate-limited one: until the
   * pool resets once its budget is used up, or as long as GitHub asks after
   * a secondary limit, and without being asked, a minute, twice as long
   * after each further one, up to 15 minutes. After a secondary limit,
   * requests go one at a time until one sent since succeeds.
   */
  function pause(
    name: RateLimitPool,
    error: Extract<GitHubError, { kind: "rate-limited" }>,
    budget: RateLimitBudget | undefined,
  ) {
    const pool = poolOf(name);
    let duration: number;
    if (error.limit === "secondary") {
      slowedAfter = sent;
      pool.secondaryLimits++;
      duration =
        error.retryAfter ??
        Math.min(
          firstBackoff * 2 ** (pool.secondaryLimits - 1),
          longestBackoff,
        );
    } else {
      const resetAt = budget?.pool === name ? budget.resetAt : undefined;
      // Without a reset still to come, e.g. with the clock off, it waits as
      // after a secondary limit, rather than asking again at once.
      duration =
        resetAt !== undefined && resetAt > now()
          ? resetAt - now()
          : firstBackoff;
    }
    const pausedAfter = sent;
    pool.pausedAfter = pausedAfter;
    pool.pausedUntil = now() + duration;
    void wait(duration).then(() => {
      // It paused again since.
      if (pool.pausedAfter !== pausedAfter) return;
      pool.pausedUntil = undefined;
      pushStates();
      pump();
    });
  }

  return {
    run<T>(
      pool: RateLimitPool,
      urgency: () => Urgency | undefined,
      send: () => Promise<GitHubResponse<T>>,
    ) {
      return new Promise<RequestResult<T>>((settle, fail) => {
        waiting.add({
          pool,
          urgency,
          send,
          order: order++,
          sentAs: 0,
          account: account(),
          settle: settle as (result: RequestResult<unknown>) => void,
          fail,
        });
        pump();
      });
    },
    sweep() {
      for (const entry of waiting) {
        if (entry.urgency() === undefined) drop(entry);
      }
    },
    cancel() {
      for (const entry of waiting) drop(entry);
      pools = freshPools();
      slowedAfter = undefined;
      pushStates();
      pushReported();
    },
    isLow,
    states,
    budgets,
  };
}

/** Every pool as the queue knows it before GitHub has said anything of it. */
function freshPools(): Map<RateLimitPool, Pool> {
  return new Map(
    rateLimitPools.map((name) => [
      name,
      {
        budget: undefined,
        pausedUntil: undefined,
        pausedAfter: 0,
        secondaryLimits: 0,
        lowUntil: undefined,
        reported: undefined,
      },
    ]),
  );
}
