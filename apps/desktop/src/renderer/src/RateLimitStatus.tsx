import type { RateLimitState } from "@verdandi/core/contract";
import { useEffect, useState } from "react";
import { rateLimitText } from "./rate-limit-text";
import { useNow } from "./use-now";

/**
 * Says in a header how GitHub's rate limits hold requests back, e.g.
 * "GitHub rate limit reached · requests paused until 14:37", and nothing
 * while they do not.
 */
export function RateLimitStatus() {
  const text = rateLimitText(useRateLimits(), useNow());
  if (text === undefined) return null;
  return (
    <span
      role="status"
      title={text}
      className="min-w-0 shrink truncate text-xs text-warning"
    >
      {text}
    </span>
  );
}

/** The rate-limit pools that hold requests back, as the core pushes them. */
function useRateLimits(): RateLimitState[] {
  const [states, setStates] = useState<RateLimitState[]>([]);
  useEffect(() => {
    let current = true;
    // A push is newer than the answer to a read that started before it.
    let pushed = false;
    const unsubscribe = window.verdandi.on("rateLimitsChanged", (changed) => {
      pushed = true;
      setStates(changed);
    });
    void window.verdandi.getRateLimits().then((read) => {
      if (current && !pushed) setStates(read);
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, []);
  return states;
}
