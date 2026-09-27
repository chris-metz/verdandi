/**
 * The one queue every GitHub request passes through. It limits how many run
 * at once; later it also orders them by priority and pauses them for rate
 * limits.
 */
export interface RequestQueue {
  run: <T>(request: () => Promise<T>) => Promise<T>;
}

export function createRequestQueue({
  concurrency,
}: {
  concurrency: number;
}): RequestQueue {
  let running = 0;
  const waiting: (() => void)[] = [];

  function startNext() {
    if (running >= concurrency) return;
    const start = waiting.shift();
    if (!start) return;
    running++;
    start();
  }

  return {
    run(request) {
      const started = new Promise<void>((start) => {
        waiting.push(start);
        startNext();
      });
      return started.then(request).finally(() => {
        running--;
        startNext();
      });
    },
  };
}
