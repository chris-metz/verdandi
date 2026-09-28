import { useEffect, useState } from "react";

/** How often the time is brought up to date. */
const tick = 30 * 1000;

/**
 * The time, brought up to date every half minute, e.g. for an age a header
 * shows.
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, tick);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}
