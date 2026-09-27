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
      /**
       * All, pinned above the sections. It is always there and never stored
       * in the settings file.
       */
      all: AllEntry;
      /**
       * The Repositories section: the tracked repositories, in the settings
       * file's order.
       */
      repositories: RepositoryEntry[];
    }
  | { status: "failed"; message: string };

/** All as the sidebar lists it. */
export interface AllEntry {
  /**
   * How many open issues every tracked repository has together: known once
   * each repository's count is, and otherwise unknown, naming the
   * repositories whose count failed.
   */
  openIssues: OpenIssueCount;
}

/** A tracked repository as the sidebar lists it. */
export interface RepositoryEntry {
  /** Its address, as the settings file names it. */
  repository: RepositoryAddress;
  openIssues: OpenIssueCount;
}

/**
 * How many open issues a tracked repository has: known once GitHub has said,
 * and unknown while it is being asked or when asking failed.
 */
export type OpenIssueCount =
  | { status: "loading" }
  | { status: "known"; count: number }
  | { status: "failed"; message: string };

/**
 * What a list in the main area shows: All, which merges every tracked
 * repository, or one tracked repository.
 */
export type Scope =
  { kind: "all" } | { kind: "repository"; repository: RepositoryAddress };

/** What the main area shows: a scope's list, or an issue page. */
export type Screen =
  { kind: "list"; scope: Scope } | { kind: "issue"; issueId: string };

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
   * The repository it lives in. In All, every row names it with a repository
   * chip.
   */
  repository: RepositoryAddress;
  /**
   * How the list names it: `#12` in its own repository's list and in All,
   * where the repository chip names the repository, and `owner/name#12` when
   * it lives in another repository than the list's.
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
  /** Whether its sub-issues show: initially expanded in lists, collapsed on pages. */
  expanded: boolean;
}

/** A parent issue that a list names instead of showing it above. */
export interface ParentIssue {
  id: string;
  /**
   * How the list names it, as for an issue it shows; in All, with no
   * repository chip beside it, always `owner/name#12`.
   */
  reference: string;
  title: string;
  /** Whether it is an external issue. */
  external: boolean;
}

/** A tree at the top level of a list. */
export interface IssueTree extends IssueNode {
  /**
   * Its parent issue, which the list does not show above it: it lives in
   * another repository with no issue of this one above it (in All, outside
   * every tracked repository, with none of them above it), or has not loaded
   * (yet).
   */
  parent: ParentIssue | undefined;
}

/**
 * How far a part of a screen has loaded, such as a repository within All, and
 * how current it is.
 *
 * - `loading`: it has not loaded yet.
 * - `refreshing`: it is being read again, and shows what it has meanwhile.
 * - `current`: it has loaded.
 * - `failed`: it could not be read.
 */
export type LoadingState =
  | { status: "loading" }
  | {
      status: "refreshing" | "current";
      /**
       * When GitHub was asked for the oldest of what it shows, in
       * milliseconds since the epoch.
       */
      updatedAt: number;
    }
  | { status: "failed"; message: string };

/** A repository within a list, and how far its open issues have loaded. */
export interface RepositoryLoading {
  repository: RepositoryAddress;
  loading: LoadingState;
}

/**
 * How far a list has loaded, and how current it is. Issues loaded before a
 * failure stay listed. The counts are known only once everything has loaded.
 *
 * - `loading`: it has not loaded yet; issues fill in as they arrive.
 * - `refreshing`: it is being read again, and shows what it has meanwhile.
 * - `current`: everything it shows has loaded.
 * - `failed`: something it shows could not be read.
 */
export type ListLoading =
  | { status: "loading" }
  | {
      status: "refreshing" | "current";
      /**
       * When GitHub was asked for the oldest of what it shows, in
       * milliseconds since the epoch.
       */
      updatedAt: number;
      /**
       * How many open issues the repository has, or in All every tracked
       * repository together.
       */
      openIssues: number;
      /**
       * How many of the repository's closed issues the list leaves out (in
       * All, of every tracked repository's): all but the ancestors of its
       * open issues and the sub-issues in it.
       */
      closedNotListed: number;
    }
  | { status: "failed"; message: string };

/**
 * A scope's list, as far as it has loaded: its sub-issue forest. The
 * repository's open issues and their closed ancestors in the same repository,
 * however many repositories lie in between, form the top level, parent
 * issues first, then the most recently updated; the sub-issues of each, open
 * or closed and from any repository, nest below it. All does the same with
 * every tracked repository at once, so an issue nests below its parent issue
 * whichever tracked repository either lives in. Each issue appears once.
 */
export interface IssueList {
  scope: Scope;
  trees: IssueTree[];
  loading: ListLoading;
  /**
   * The repositories All merges, once they are known, in the settings file's
   * order, each with how far its open issues have loaded. None in a
   * repository's list, whose loading is the list's own.
   */
  repositories: RepositoryLoading[];
}

/** Metadata read when an issue page is opened. */
export interface IssueMetadata {
  stateReason:
    "completed" | "not-planned" | "reopened" | "duplicate" | undefined;
  createdAt: string;
  author: IssueActor | undefined;
  assignees: IssueActor[];
  milestone: string | undefined;
  commentCount: number;
}

export interface IssueActor {
  login: string;
  avatarUrl: string;
}

/** An issue page, including relationships outside tracked repositories. */
export interface IssuePage {
  issueId: string;
  issue: (IssueSummary & IssueMetadata) | undefined;
  /** Top-most parent first, excluding the issue itself. */
  ancestry: (ParentIssue & { url: string })[];
  /** The list's outline rows, in GitHub order, initially collapsed. */
  subIssues: IssueTree[];
  /**
   * How far the page has loaded, and how current it is. What loaded before a
   * failure stays usable.
   */
  loading: LoadingState;
}

/** Request/response calls. */
export interface CoreRequests {
  /**
   * Opens an issue page: an issue with its ancestry and sub-issues, from any
   * repository, tracked or not. Its current state is pushed as
   * `issuePageChanged` at once, and again when it has loaded. A page opened
   * again shows what it has, and is read again in the background when it is
   * older than five minutes, or at once if it failed. The sidebar's counts
   * are read again too if they are older than five minutes. The renderer
   * keeps each visit's cursor, expansion and scroll position.
   */
  openIssuePage: (issueId: string) => Promise<void>;
  /** Which account Verdandi reads GitHub as. */
  getAccount: () => Promise<AccountStatus>;
  /**
   * What the sidebar lists, read from the settings file. Open-issue counts
   * the core does not know yet are asked for in one request for all of them,
   * without reading any issues, and arrive as `sidebarChanged`. A count that
   * could not be read is asked for again the next time.
   */
  getSidebar: () => Promise<SidebarEntries>;
  /**
   * Opens a scope's list. Its current state is pushed as `listChanged` at
   * once, then again as each page of open issues and each batch of the other
   * issues it shows arrives. Only the opened scope is loaded: opening it again
   * shows what is loaded or loading, and reads it again in the background
   * when it is older than five minutes, or at once if it failed. All loads
   * every tracked repository side by side, and shares each repository's open
   * issues with that repository's list, so neither reads again what the
   * other has read in the last five minutes. The sidebar's counts are read
   * again too if they are older than five minutes.
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
  /**
   * Reads everything on screen again now, however recently it was read: the
   * sidebar's counts, and the screen the main area shows, if any, pushing
   * them as they change. What they have shows meanwhile. A list reads its
   * repositories' open issues and the other issues it shows, with the
   * sub-issues of expanded ones; those of collapsed ones are read again once
   * they show.
   */
  refresh: (screen: Screen | undefined) => Promise<void>;
  /**
   * What is on screen is shown again, e.g. as the window regains focus: the sidebar's counts, and the screen the main area shows, if any,
   * once opened. What is older than five minutes is read again in the
   * background, as opening a screen would.
   */
  revalidate: (screen: Screen | undefined) => Promise<void>;
}

/** Events the core pushes, by name, with their payloads. */
export interface CoreEvents {
  /** GitHub now answers as a different account than it did before. */
  accountChanged: Account;
  /** A list's state, when it is opened and whenever it changes. */
  listChanged: IssueList;
  /** An issue page's state, when it is opened and whenever it changes. */
  issuePageChanged: IssuePage;
  /**
   * The sidebar as last read, whenever an open-issue count changes: when
   * counts arrive, and when a repository's list loads with a new count.
   */
  sidebarChanged: SidebarEntries;
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
  openIssuePage: true,
  getAccount: true,
  getSidebar: true,
  openList: true,
  setExpanded: true,
  setAllExpanded: true,
  refresh: true,
  revalidate: true,
};
const events: Record<CoreEventName, true> = {
  accountChanged: true,
  listChanged: true,
  issuePageChanged: true,
  sidebarChanged: true,
};

/** Every request name, for wiring the contract to a transport. */
export const requestNames = Object.keys(requests) as (keyof CoreRequests)[];

/** Every event name, for wiring the contract to a transport. */
export const eventNames = Object.keys(events) as CoreEventName[];
