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

/**
 * A repository's current address on GitHub, `owner/name`. It changes when
 * the repository is renamed or transferred.
 */
export interface RepositoryAddress {
  owner: string;
  name: string;
}

/** The sidebar's entries, or why the settings file could not be read. */
export type SidebarEntries =
  | {
      status: "read";
      /** The tracked repositories, in the settings file's order. */
      repositories: RepositoryAddress[];
    }
  | { status: "failed"; message: string };

/** What a list in the main area shows: so far, a tracked repository. */
export type Scope = { kind: "repository"; repository: RepositoryAddress };

/** An issue as a list shows it. */
export interface IssueSummary {
  /** GitHub's node ID, the same wherever the issue appears. */
  id: string;
  number: number;
  title: string;
  state: "open" | "closed";
}

/** How far a list has loaded. Issues loaded before a failure stay listed. */
export type ListLoading =
  | { status: "loading" }
  | { status: "loaded" }
  | { status: "failed"; message: string };

/** A scope's list, as far as it has loaded. */
export interface IssueList {
  scope: Scope;
  issues: IssueSummary[];
  loading: ListLoading;
}

/** Request/response calls. */
export interface CoreRequests {
  /** Which account Verdandi reads GitHub as. */
  getAccount: () => Promise<AccountStatus>;
  /** What the sidebar lists. It sends no GitHub requests. */
  getSidebar: () => Promise<SidebarEntries>;
  /**
   * Opens a scope's list. Its current state is pushed as `listChanged` at
   * once, then again as each page arrives. Only the opened scope is loaded,
   * once per session: opening it again reuses what is loaded or loading, and
   * loads it again only if it failed.
   */
  openList: (scope: Scope) => Promise<void>;
}

/** Events the core pushes, by name, with their payloads. */
export interface CoreEvents {
  /** GitHub now answers as a different account than it did before. */
  accountChanged: Account;
  /** A list's state, when it is opened and whenever it changes. */
  listChanged: IssueList;
}

export type CoreEventName = keyof CoreEvents;

export type Unsubscribe = () => void;

export interface Contract extends CoreRequests {
  on: <E extends CoreEventName>(
    event: E,
    listener: (payload: CoreEvents[E]) => void,
  ) => Unsubscribe;
}

const requests: Record<keyof CoreRequests, true> = {
  getAccount: true,
  getSidebar: true,
  openList: true,
};
const events: Record<CoreEventName, true> = {
  accountChanged: true,
  listChanged: true,
};

/** Every request name, for wiring the contract to a transport. */
export const requestNames = Object.keys(requests) as (keyof CoreRequests)[];

/** Every event name, for wiring the contract to a transport. */
export const eventNames = Object.keys(events) as CoreEventName[];
