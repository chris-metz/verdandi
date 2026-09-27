/**
 * The one contract between the core and every user interface. The core
 * implements it directly; the desktop app's main process only forwards it over
 * IPC, and the renderer calls it through preload. Everything that crosses it
 * must survive structured cloning.
 */

/** A GitHub account on a host. The MVP reads github.com only. */
export interface Account {
  login: string;
  host: "github.com";
}

export type AccountStatus =
  { status: "known"; account: Account } | { status: "failed"; message: string };

/** Request/response calls. */
export interface CoreRequests {
  /** Which account Verdandi reads GitHub as. */
  getAccount: () => Promise<AccountStatus>;
}

/** Events the core pushes, by name, with their payloads. */
export interface CoreEvents {
  /** GitHub now answers as a different account than it did before. */
  accountChanged: Account;
}

export type CoreEventName = keyof CoreEvents;

export type Unsubscribe = () => void;

export interface Contract extends CoreRequests {
  on: <E extends CoreEventName>(
    event: E,
    listener: (payload: CoreEvents[E]) => void,
  ) => Unsubscribe;
}

const requests: Record<keyof CoreRequests, true> = { getAccount: true };
const events: Record<CoreEventName, true> = { accountChanged: true };

/** Every request name, for wiring the contract to a transport. */
export const requestNames = Object.keys(requests) as (keyof CoreRequests)[];

/** Every event name, for wiring the contract to a transport. */
export const eventNames = Object.keys(events) as CoreEventName[];
