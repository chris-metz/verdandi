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

/** A GitHub label. */
export interface Label {
  name: string;
  /** GitHub's colour for it: six hex digits, without `#`. */
  color: string;
}

/** How many of an issue's relationships of one kind are open, of all. */
export interface RelationshipCount {
  open: number;
  total: number;
}

/** How many of an issue's sub-issues are closed, of all. */
export interface SubIssueProgress {
  closed: number;
  total: number;
}

/** An issue as a list shows it. */
export interface IssueSummary {
  /** GitHub's node ID, the same wherever the issue appears. */
  id: string;
  /**
   * How the list names it: `#12` in its own repository's list, and
   * `owner/name#12` when it lives in another repository.
   */
  reference: string;
  title: string;
  state: "open" | "closed";
  /** Its page on github.com. */
  url: string;
  /** Its labels, in GitHub's order. */
  labels: Label[];
  /** Whether it is an external issue: outside every tracked repository. */
  external: boolean;
  /** Sub-issue progress, from GitHub's `subIssuesSummary`. */
  subIssueProgress: SubIssueProgress;
  /** Issues blocking it, from GitHub's `issueDependenciesSummary`. */
  blockedBy: RelationshipCount;
  /** Issues it blocks, from GitHub's `issueDependenciesSummary`. */
  blocking: RelationshipCount;
}

/** An issue in a list, with its sub-issues nested below it. */
export interface IssueNode {
  issue: IssueSummary;
  /** Its sub-issues in GitHub's order, as far as they have loaded. */
  subIssues: IssueNode[];
  /** Whether its sub-issues show. Trees start fully expanded. */
  expanded: boolean;
}

/** A parent issue that a list names instead of showing it above. */
export interface ParentIssue {
  id: string;
  /** How the list names it, as for an issue it shows. */
  reference: string;
  title: string;
  /** Whether it is an external issue. */
  external: boolean;
}

/** A tree at the top level of a list. */
export interface IssueTree extends IssueNode {
  /**
   * Its parent issue, which the list does not show above it: it lives in
   * another repository with no issue of this one above it, or has not loaded
   * (yet).
   */
  parent: ParentIssue | undefined;
}

/**
 * How far a list has loaded. Issues loaded before a failure stay listed. The
 * counts are known only once everything has loaded.
 */
export type ListLoading =
  | { status: "loading" }
  | {
      status: "loaded";
      /** How many open issues the repository has. */
      openIssues: number;
      /**
       * How many of the repository's closed issues the list leaves out: all
       * but the ancestors of its open issues and the sub-issues in it.
       */
      closedNotListed: number;
    }
  | { status: "failed"; message: string };

/**
 * A scope's list, as far as it has loaded: its sub-issue forest. The
 * repository's open issues and their closed ancestors in the same repository,
 * however many repositories lie in between, form the top level, parent
 * issues first, then the most recently updated; the sub-issues of each, open
 * or closed and from any repository, nest below it. Each issue appears once.
 */
export interface IssueList {
  scope: Scope;
  trees: IssueTree[];
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
   * once, then again as each page of open issues and each batch of the other
   * issues it shows arrives. Only the opened scope is loaded, once per
   * session: opening it again reuses what is loaded or loading, and loads it
   * again only if it failed.
   */
  openList: (scope: Scope) => Promise<void>;
  /**
   * Expands or collapses one issue's sub-issues in an opened scope's list,
   * then pushes the list. Each list keeps its expansion for the session.
   */
  setExpanded: (
    scope: Scope,
    issueId: string,
    expanded: boolean,
  ) => Promise<void>;
  /**
   * Expands or collapses every tree of an opened scope's list, including
   * issues that load later, then pushes the list.
   */
  setAllExpanded: (scope: Scope, expanded: boolean) => Promise<void>;
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
  setExpanded: true,
  setAllExpanded: true,
};
const events: Record<CoreEventName, true> = {
  accountChanged: true,
  listChanged: true,
};

/** Every request name, for wiring the contract to a transport. */
export const requestNames = Object.keys(requests) as (keyof CoreRequests)[];

/** Every event name, for wiring the contract to a transport. */
export const eventNames = Object.keys(events) as CoreEventName[];
