import type { Unsubscribe } from "./contract.ts";

/** A minimal typed event emitter keyed by event name. */
export interface Emitter<Events> {
  on: <E extends keyof Events>(
    event: E,
    listener: (payload: Events[E]) => void,
  ) => Unsubscribe;
  emit: <E extends keyof Events>(event: E, payload: Events[E]) => void;
}

export function createEmitter<Events>(): Emitter<Events> {
  const listeners = new Map<keyof Events, Set<(payload: never) => void>>();
  return {
    on(event, listener) {
      const forEvent = listeners.get(event) ?? new Set();
      listeners.set(event, forEvent);
      forEvent.add(listener);
      return () => {
        forEvent.delete(listener);
      };
    },
    emit(event, payload) {
      for (const listener of listeners.get(event) ?? []) {
        (listener as (payload: Events[typeof event]) => void)(payload);
      }
    },
  };
}
