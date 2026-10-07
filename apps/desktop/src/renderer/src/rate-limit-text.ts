import type { RateLimitState } from "@verdandi/core/contract";
import { timeOf } from "./freshness";

/**
 * What a header says of the rate-limit pools that hold requests back, e.g.
 * "GitHub rate limit reached · requests paused until 14:37", or nothing
 * while none does. REST search is named apart from GraphQL and the REST API.
 */
export function rateLimitText(
  states: readonly RateLimitState[],
  now: number,
): string | undefined {
  const texts = states.map(({ pool, status, until }) => {
    const limit = pool === "search" ? "search limit" : "rate limit";
    const time = timeOf(until, now);
    return status === "paused"
      ? `GitHub ${limit} reached · requests paused until ${time}`
      : `GitHub ${limit} low · automatic refresh off until ${time}`;
  });
  return texts.length > 0 ? [...new Set(texts)].join(" · ") : undefined;
}
