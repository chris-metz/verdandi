import type { ListLoading, LoadingState } from "./contract.ts";

/**
 * A moment in the core's time: the clock's time, and the order of moments
 * taken within the same millisecond. What GitHub was asked after a refresh
 * started thus reads as newer than the refresh even while the clock stands
 * still.
 */
export interface Moment {
  /** Milliseconds since the epoch. */
  time: number;
  /** Counts up with every moment taken. */
  order: number;
}

/**
 * Data older than this, in milliseconds, is read again when its screen is
 * opened or shown again, e.g. as the window regains focus.
 */
const revalidateAfter = 5 * 60 * 1000;

/** Takes the current moment. */
export type Clock = () => Moment;

export function createClock(now: () => number): Clock {
  let order = 0;
  return () => ({ time: now(), order: order++ });
}

/**
 * Five minutes ago, from the start of that millisecond: what GitHub was asked
 * since is recent enough to show without asking again.
 */
export function fiveMinutesAgo(clock: Clock): Moment {
  return { time: clock().time - revalidateAfter, order: -Infinity };
}

/**
 * Whether a screen, or a part of one, shows everything it has loaded, or
 * what it read before reading it again failed, and that is older than five
 * minutes, so that it is read again as it is opened or shown again.
 */
export function isOutdated(
  loading: LoadingState | ListLoading,
  clock: Clock,
): boolean {
  return (
    (loading.status === "current" || loading.status === "stale") &&
    loading.updatedAt < clock().time - revalidateAfter
  );
}

/** Whether `moment` came at or after `since`. */
export function atOrAfter(moment: Moment, since: Moment): boolean {
  return (
    moment.time > since.time ||
    (moment.time === since.time && moment.order >= since.order)
  );
}
