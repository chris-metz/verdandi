import type { ConfigState } from "@verdandi/core/contract";
import { useEffect, useState } from "react";
import type { RendererContract } from "../../shared/ipc";

/**
 * Calls `listener` with `config.toml` as it is now, then with each change,
 * until `stop` is called. A first read that a pushed change overtook is
 * dropped. `ready` settles once the first read is in, or has failed.
 */
export function followConfig(
  verdandi: Pick<RendererContract, "getConfig" | "on">,
  listener: (state: ConfigState) => void,
): { ready: Promise<void>; stop: () => void } {
  let pushed = false;
  let stopped = false;
  const unsubscribe = verdandi.on("configChanged", (state) => {
    if (stopped) return;
    pushed = true;
    listener(state);
  });
  const ready = verdandi.getConfig().then(
    (state) => {
      if (!pushed && !stopped) listener(state);
    },
    () => undefined,
  );
  return {
    ready,
    stop() {
      stopped = true;
      unsubscribe();
    },
  };
}

/** `config.toml` as the core last read or pushed it. */
export function useConfig(): ConfigState | undefined {
  const [state, setState] = useState<ConfigState>();
  useEffect(() => followConfig(window.verdandi, setState).stop, []);
  return state;
}
