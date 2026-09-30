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

/**
 * Where gh's token for github.com comes from: its stored credentials, or an
 * environment variable Verdandi inherited, which overrides them. Only the
 * source is ever named, never the token.
 */
export type TokenSource = "stored" | "GH_TOKEN" | "GITHUB_TOKEN";

/** The account gh reads github.com as, or why that is not confirmed. */
export type AccountStatus =
  | { status: "known"; account: Account; tokenSource: TokenSource }
  /**
   * gh could not check its credentials, e.g. without a connection. That is
   * no reason to block Verdandi: GitHub's answers will tell.
   */
  | { status: "unconfirmed"; message: string };

/** A usable gh executable. */
export interface GhExecutable {
  /** Where it is, as found or chosen. */
  path: string;
  /** Its version, e.g. `2.101.0`. */
  version: string;
}

/** A gh executable that was found or chosen but cannot be used, and why. */
export interface UnusableGh {
  path: string;
  reason: string;
}

/**
 * Whether Verdandi can read GitHub. It needs a usable gh, signed in to
 * github.com; until it has one, the setup blocker covers the whole app, and
 * nothing is asked of GitHub. Installing gh and signing in happen outside
 * Verdandi.
 *
 * - `checking`: the first check at startup has not finished.
 * - `ready`: gh is usable and its credentials are not known to fail.
 * - `blocked`: gh is missing or unusable, or `gh auth status` confirmed that
 *   its credentials for github.com are missing or rejected.
 */
export type Setup =
  | { status: "checking" }
  | { status: "ready"; gh: GhExecutable; account: AccountStatus }
  | { status: "blocked"; problem: SetupProblem };

/** Why the setup blocker covers the app. */
export type SetupProblem =
  /**
   * No usable gh was found: neither where the user chose it, nor on PATH,
   * nor in a well-known install location. Those found there but unusable are
   * named, with why.
   */
  | { kind: "no-usable-gh"; notUsable: UnusableGh[] }
  /** gh has no credentials for github.com. */
  | { kind: "signed-out"; gh: GhExecutable }
  /** GitHub rejected gh's credentials for github.com, e.g. an expired token. */
  | {
      kind: "credentials-rejected";
      gh: GhExecutable;
      /** The account they belong to, when gh knows it. */
      login: string | undefined;
      tokenSource: TokenSource;
    };

/** What became of choosing a gh executable. */
export type GhChoice =
  /** It is no usable gh; nothing changed. */
  | ({ status: "invalid" } & UnusableGh)
  /** It is used and remembered on this machine; the setup as checked with it. */
  | { status: "chosen"; setup: Setup };

/** Something the user is told briefly, as it happens. */
export type Notice =
  /**
   * The gh the user chose is gone or no longer usable, so Verdandi forgot it
   * and uses one it found on its own.
   */
  | { kind: "gh-replaced"; previous: string; gh: GhExecutable }
  /**
   * GitHub is read as another account than before, e.g. after `gh auth
   * switch`: everything read as the previous one was dropped, and what is on
   * screen is read again. The tracked repositories stay as they are.
   */
  | { kind: "account-changed"; previous: Account; account: Account }
  /**
   * Tracked repositories were renamed or transferred, so their entries now
   * carry their new addresses; several found at once come together. A
   * change only in case is corrected without a notice.
   */
  | { kind: "repositories-renamed"; renamed: RepositoryRename[] }
  /**
   * `settings.json` listed repositories more than once under the same GitHub
   * ID, e.g. after a hand edit or syncing: the entry higher in the sidebar
   * stayed, and the others were removed.
   */
  | {
      kind: "duplicate-repositories-removed";
      removed: { repository: RepositoryAddress; sameAs: RepositoryAddress }[];
    };

/** A tracked repository that GitHub now knows under another address. */
export interface RepositoryRename {
  from: RepositoryAddress;
  to: RepositoryAddress;
  /**
   * The saved views whose search names `repo:` and the old address, which
   * GitHub's search does not follow; they are not rewritten.
   */
  views: SavedView[];
}

/**
 * Why GitHub would not let this account read something, named only when
 * GitHub's answer says so.
 */
export type AccessEvidence =
  /**
   * The organization enforces SAML single sign-on, and gh's credentials are
   * not authorized for it. The link to authorize them comes only from
   * GitHub's answer.
   */
  | { kind: "sso"; message: string; url: string | undefined }
  /** The organization restricts OAuth App access and has not approved gh. */
  | { kind: "organization-approval"; message: string };

/**
 * A pool of GitHub's rate limits, each with its own budget: GraphQL, the REST
 * API, and REST search.
 */
export type RateLimitPool = "graphql" | "core" | "search";

/**
 * How a rate-limit pool holds Verdandi's requests back, as GitHub's answers
 * report its budget.
 *
 * - `paused`: GitHub's rate limit stopped the pool's requests: they wait
 *   until `until`, when the pool resets, or as long as GitHub asked, and then
 *   go on on their own. The other pools go on meanwhile, and what was read
 *   stays browsable.
 * - `low`: less than a tenth of the pool's budget is left until it resets at
 *   `until`. Screens are no longer read again on their own as they open or
 *   the window regains focus; what was never read, Retry and refresh still
 *   are.
 */
export interface RateLimitState {
  pool: RateLimitPool;
  status: "paused" | "low";
  /** In milliseconds since the epoch. */
  until: number;
}

/** Why something could not be read. */
export type Problem =
  /** GitHub could not be reached, e.g. without a connection. */
  | { kind: "unreachable"; message: string }
  /**
   * GitHub would not show it to this account: it may not exist, or this
   * account may not read it. GitHub does not say which, unless `access`
   * names why.
   */
  | {
      kind: "unavailable";
      access: AccessEvidence | undefined;
      /** Only when the readable repository reports `hasIssuesEnabled: false`. */
      issuesDisabled?: true;
      /**
       * Only for a tracked repository whose address now leads to a different
       * repository, while the one tracked cannot be read by its ID.
       */
      nameTakenOver?: true;
    }
  /**
   * Reading it stopped before GitHub was asked, as its screen was left; it is
   * read again once the screen shows again.
   */
  | { kind: "interrupted" }
  /**
   * Anything else, e.g. a server error that persisted after retrying, or a
   * settings file that cannot be read.
   */
  | { kind: "error"; message: string };

/**
 * A repository's current address on GitHub, `owner/name`. It changes when
 * the repository is renamed or transferred.
 */
export interface RepositoryAddress {
  owner: string;
  name: string;
}

/** A stored repository, with its stable GitHub identity once verified. */
export type TrackedRepository = RepositoryAddress & { id?: number };

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
      /** The Views section: the saved views, in the settings file's order. */
      views: ViewEntry[];
      settings: SettingsStatus;
      /**
       * Whether the settings file does not exist yet: Verdandi is launched
       * for the first time, and the repository picker opens once the setup is
       * ready. Adding a repository creates the file, and so does **Skip**.
       */
      firstLaunch: boolean;
    }
  | { status: "failed"; message: string };

/** Whether repository and view changes can be written safely. */
export type SettingsStatus =
  | { status: "writable" }
  | { status: "invalid" | "newer-version"; message: string };

/**
 * Whether Verdandi shows the user's light theme or dark theme: following the
 * operating system, always light, or always dark.
 */
export type Appearance = "system" | "light" | "dark";

/** How Verdandi looks, as `config.toml` sets it. */
export interface Config {
  appearance: Appearance;
  /** The ID of the light theme. */
  lightTheme: string;
  /** The ID of the dark theme. */
  darkTheme: string;
}

/** `config.toml` as Verdandi read it, and what it uses of it. */
export interface ConfigState {
  /**
   * What Verdandi uses: the file's values, each one that cannot be used
   * replaced by its default, or every default when the file cannot be read.
   */
  config: Config;
  /** Where the file is. */
  file: string;
  /**
   * - `missing`: there is no file, so every default applies. Verdandi does
   *   not create it; a change in the settings dialog will.
   * - `read`: it was read as TOML.
   * - `unreadable`: it cannot be read, or not as TOML. Nothing may write it
   *   until it can.
   */
  status: "missing" | "read" | "unreadable";
  /**
   * What in the file cannot be used, in the file's order; empty when all of
   * it can. The user is told until the file is fixed.
   */
  problems: ConfigProblem[];
}

/** Whether a change to `config.toml` was written, and why not. */
export type ConfigChangeResult = { ok: true } | { ok: false; message: string };

/** Something in `config.toml` Verdandi cannot use, and what it does instead. */
export interface ConfigProblem {
  /** The key, when it is one key's value or an unknown key. */
  key?: string;
  /** The line, counted from 1, when it is known. */
  line?: number;
  /**
   * What the user is told: the file, the key and line, and the default used
   * instead.
   */
  message: string;
}

/** A saved GitHub issue search, in sidebar order. */
export interface SavedView {
  id: string;
  name: string;
  query: string;
}

/** A saved view as the sidebar lists it. */
export interface ViewEntry {
  view: SavedView;
  matches: ViewMatchCount;
}

/**
 * How many matches a view's search had when it last ran, as GitHub counts
 * them: unknown until it has run in this session (no search runs at
 * startup), or while its last run could not be completed; or GitHub rejected
 * the search. A view whose search changed has not run yet.
 */
export type ViewMatchCount =
  | { status: "unknown" }
  | { status: "known"; count: number }
  | { status: "rejected"; message: string };

/**
 * A view's name and search as the user entered them, to save: a new view
 * without an `id`, or the view with that `id`, which keeps it.
 */
export interface ViewDraft {
  id?: string;
  name: string;
  query: string;
  /**
   * The view a new view goes right after, such as the one it duplicates;
   * without it, or once that view is gone, it goes to the end.
   */
  after?: string;
}

/**
 * What became of saving a view. Nothing is saved unless it says `saved`.
 *
 * - `saved`: it is saved, a new one where its draft's `after` says, as its
 *   search ran, or without running it when only its name changed or it was
 *   saved anyway.
 * - `rejected`: GitHub rejected the search, saying why.
 * - `unchecked`: the search could not be run, e.g. GitHub could not be
 *   reached or failed; it can be saved anyway, or tried again.
 * - `failed`: it cannot be saved, e.g. as the settings file cannot be
 *   written, or it has no name or search.
 */
export type ViewSave =
  | { status: "saved"; view: SavedView }
  | { status: "rejected"; message: string }
  | { status: "unchecked"; problem: Problem }
  | { status: "failed"; message: string };

/** All is fixed and cannot be the source or destination of a move. */
export type SidebarEntryKey =
  | { kind: "repository"; repository: RepositoryAddress }
  | { kind: "view"; id: string };

/** A move relative to the latest file, never a replacement of its whole order. */
export type SidebarDestination =
  | { direction: "up" | "down" }
  | { relativeTo: SidebarEntryKey; side: "before" | "after" };

export type SettingsChangeResult =
  { ok: true } | { ok: false; message: string };

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
  repository: TrackedRepository;
  openIssues: OpenIssueCount;
  /** Confirmed access failure; transient failures never make an entry unavailable. */
  unavailable?: Extract<Problem, { kind: "unavailable" }>;
  /** Archived repositories remain readable. */
  archived?: true;
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

/**
 * Which issues of its scope a list matches: its open issues, or its closed
 * ones. A view's state comes from its search text instead.
 */
export type IssueState = "open" | "closed";

/**
 * A list whose issues expand and collapse, and which a label filter
 * narrows: a scope's, or a view's.
 */
export type ExpandableList = Scope | { kind: "view"; viewId: string };

/** The selected sidebar entry, with the current view text when it is a view. */
export type SidebarSelection = Scope | { kind: "view"; view: SavedView };

/** What the main area shows: a scope's list, a view, or an issue page. */
export type Screen =
  | { kind: "list"; scope: Scope }
  | { kind: "view"; viewId: string }
  | { kind: "issue"; issueId: string };

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

/**
 * What a list or page knows of an issue before or without reading it: what
 * the relationship that names it says.
 */
export interface IssueIdentity {
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
  /** Whether it is an external issue: outside every tracked repository. */
  external: boolean;
}

/** An issue as a list shows it. */
export interface IssueSummary extends IssueIdentity {
  /** Who opened it, unless their account has been deleted. */
  author: IssueActor | undefined;
  /** When it was opened, as an ISO 8601 timestamp. */
  createdAt: string;
  /** Its labels, in GitHub's order. */
  labels: Label[];
  /** Sub-issue progress, from GitHub's `subIssuesSummary`. */
  subIssueProgress: SubIssueProgress;
  /** Issues blocking it, from GitHub's `issueDependenciesSummary`. */
  blockedBy: RelationshipCount;
  /** Issues it blocks, from GitHub's `issueDependenciesSummary`. */
  blocking: RelationshipCount;
  /**
   * Why GitHub left out part of it, such as a sub-issue or its parent issue
   * this account may not read, when GitHub said so; the rest shows. It is
   * read again as failed parts are.
   */
  incomplete: Problem | undefined;
}

/** An issue in a list, with its sub-issues nested below it. */
export type IssueNode = ReadIssueNode | UnreadIssueNode;

/** An issue that has been read, with its sub-issues nested below it. */
export interface ReadIssueNode {
  issue: IssueSummary;
  /** Its sub-issues in GitHub's order, read or not. */
  subIssues: IssueNode[];
  /**
   * Whether its sub-issues show: initially expanded in lists, collapsed on
   * pages, and in a view on a path to a match.
   */
  expanded: boolean;
  unread?: undefined;
  /**
   * How a view, or a list its label filter narrows, shows it; none in a
   * list without a label filter, nor on pages.
   */
  mark?: MatchMark;
}

/**
 * An issue a relationship names that has not been read: loading, or failed.
 * It shows what the relationship says of it; its sub-issues are unknown.
 */
export interface UnreadIssueNode {
  issue: IssueIdentity;
  subIssues: [];
  expanded: false;
  unread: UnreadIssue;
  /**
   * How a view, or a list its label filter narrows, shows it; none in a
   * list without a label filter, nor on pages.
   */
  mark?: MatchMark;
}

/**
 * How a view, or a list its label filter narrows, shows an issue in its
 * tree: as a match, or as a context issue, which shows only as an ancestor
 * or sub-issue of a match. In a view, a match is an issue its search
 * returned; with a label filter, only one that carries every label of it.
 * Context issues are dimmed; closed matches are not.
 */
export interface MatchMark {
  match: boolean;
  /**
   * Whether a context issue in a view may match too: the search's results
   * are not complete, so that it did not return the issue proves nothing,
   * and the issue lacks no label of the label filter, as far as it has been
   * read. Never for a match, nor outside views.
   */
  mayMatch: boolean;
  /**
   * How many matches lie below it, at any depth, collapsed away or not. An
   * issue with matches below it is on a path to a match.
   */
  matchesInside: number;
}

/** Why an issue a relationship names shows only as the relationship names it. */
export type UnreadIssue =
  /** It is being read, or will be. */
  | { status: "loading" }
  /** It could not be read, or GitHub would not show it to this account. */
  | { status: "failed"; problem: Problem };

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
  /** Why it has not been read, unless it has. */
  unread: UnreadIssue | undefined;
}

/** A tree at the top level of a list. */
export type IssueTree = IssueNode & {
  /**
   * Its parent issue, which the list does not show above it: it lives in
   * another repository with no issue of this one above it (in All, outside
   * every tracked repository, with none of them above it), or has not loaded
   * (yet).
   */
  parent: ParentIssue | undefined;
};

/**
 * A tree at the top level of a view: the top-level issue above one or more
 * matches, as far as their ancestry has loaded. `parent` is none.
 */
export type ViewTree = IssueTree & {
  /**
   * The parent issue above the tree that the view cannot show yet or at
   * all: loading, until the matches' parent issues have loaded; or failed,
   * as unavailable when GitHub does not show it to this account (its
   * search named a parent that reading the match left out), or with why it
   * could not be loaded. None once the tree reaches its top-level issue.
   */
  missingParent: UnreadIssue | undefined;
};

/**
 * How far a part of a screen has loaded, such as a repository within All, and
 * how current it is.
 *
 * - `loading`: it has not loaded yet.
 * - `refreshing`: it is being read again, and shows what it has meanwhile.
 * - `current`: it has loaded.
 * - `stale`: reading it again failed, e.g. GitHub could not be reached, so it
 *   shows what was read before.
 * - `failed`: it could not be read, and there is nothing to show from before:
 *   it never loaded, or GitHub would no longer show it to this account.
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
  | {
      status: "stale";
      /** When GitHub was asked for the oldest of what it shows. */
      updatedAt: number;
      problem: Problem;
    }
  | { status: "failed"; problem: Problem };

/**
 * A repository within a list, and how far its issues in the list's state
 * have loaded.
 */
export interface RepositoryLoading {
  repository: RepositoryAddress;
  loading: LoadingState;
}

/**
 * How far a list has loaded, and how current it is. The counts are known only
 * once its matches have loaded; in All, they count the
 * repositories that have. Issues and repositories that could not be read show
 * where they belong, in the list or in All's `repositories`.
 *
 * - `loading`: it has not loaded yet; issues fill in as they arrive.
 * - `refreshing`: it is being read again, and shows what it has meanwhile.
 * - `current`: everything it shows has loaded.
 * - `stale`: reading it again failed, e.g. GitHub could not be reached, so it
 *   shows what was read before.
 * - `failed`: its matches could not be read, of its repository or in All
 *   of every tracked repository, and there is nothing to show from before.
 *   What loaded before the failure stays listed, e.g. the first pages.
 */
export type ListLoading =
  | {
      status: "loading";
      /**
       * How many closed issues have been read so far, while a closed list
       * first loads; none for an open list.
       */
      progress?: ListProgress;
    }
  | ({
      status: "refreshing" | "current";
      /**
       * When GitHub was asked for the oldest of what it shows, in
       * milliseconds since the epoch.
       */
      updatedAt: number;
    } & ListCounts)
  | ({
      status: "stale";
      /** When GitHub was asked for the oldest of what it shows. */
      updatedAt: number;
      problem: Problem;
    } & ListCounts)
  | { status: "failed"; problem: Problem };

/** How far a closed list's first read has come. */
export interface ListProgress {
  /** How many closed issues have been read. */
  read: number;
  /**
   * How many closed issues the repository has, or in All every tracked
   * repository together, as GitHub counted them when last asked; unknown
   * until it has been asked for each.
   */
  total: number | undefined;
}

/** What a list counts once its matches have loaded. */
export interface ListCounts {
  /**
   * How many matches the list has: of its scope's issues, those that carry
   * every label of its label filter, or all of them without one.
   */
  matches: number;
  /**
   * How many issues its scope has: the repository's issues in the list's
   * state, or in All those of every tracked repository together.
   */
  inScope: number;
  /**
   * How many of the repository's closed issues an open list leaves out (in
   * All, of every tracked repository's): all but the ancestors of its open
   * issues and the sub-issues in it. Always 0 in a closed list, and in a
   * list its label filter narrows.
   */
  closedNotListed: number;
}

/**
 * A scope's list in its state, as far as it has loaded: its sub-issue
 * forest. The repository's issues in that state, its matches, and their
 * ancestors in the same repository, open or closed, however many
 * repositories lie in between, form the top level; the sub-issues of each,
 * open or closed and from any repository, nest below it. The trees stand by
 * the newest match inside each, most recent first: by when it was opened in
 * an open list, and by when it was closed in a closed one. All does the same
 * with every tracked repository at once, so an issue nests below its parent
 * issue whichever tracked repository either lives in. Each issue appears
 * once. An interface dims the issues in the other state than the list's:
 * closed ones in an open list, open ones in a closed list.
 *
 * A label filter narrows it to the matches that carry every label of it,
 * each under its ancestors with all its sub-issues below, as the trees stand
 * by the newest match inside each; every other issue shows as a context
 * issue, and trees without a match drop out. Each issue is marked a match
 * or a context issue then, and an interface dims the context issues
 * instead.
 */
export interface IssueList {
  scope: Scope;
  /** Which of the scope's issues it matches: open, unless switched. */
  state: IssueState;
  /**
   * The scope's label filter, in both its states: its labels in the order
   * they were added, each as it was clicked; none without one.
   */
  labelFilter: Label[];
  /** Only for a repository scope, once GitHub reports it archived. */
  archived?: true;
  trees: IssueTree[];
  loading: ListLoading;
  /**
   * The repositories All merges, once they are known, in the settings file's
   * order, each with how far its matches have loaded; one that failed is
   * missing from the list, or shows as it was before. None in a repository's
   * list, whose loading is the list's own.
   */
  repositories: RepositoryLoading[];
}

/**
 * A view's screen: the issues its search matches, from any repository,
 * tracked or not, each under its whole ancestry up to its top-level issue,
 * as far as its search has run and their parent issues and sub-issues have
 * loaded. An ancestor on a path to a match shows all its sub-issues in
 * GitHub's order; those that do not match are context issues, and so are
 * the sub-issues of a match. Each issue appears once, a matching sub-issue
 * of a match below it. The trees are in the order of the search's rank of
 * the first match anywhere inside each. Until their parent issues have
 * loaded, the matches show on their own, in the search's order.
 *
 * A label filter narrows the matches to the issues the search returned that
 * carry every label of it; trees without a match drop out. An issue that
 * lacks one is known not to match, however complete the search's results.
 *
 * A path to a match expands the first time it shows; a match without a
 * matching sub-issue starts collapsed. Once expanded or collapsed, by the
 * view or the user, an issue stays so for the session, as its search runs
 * again.
 */
export interface ViewList {
  /** The view, as the settings file names it now. */
  view: SavedView;
  /**
   * Its label filter: its labels in the order they were added, each as it
   * was clicked; none without one. It never changes the view's search text.
   */
  labelFilter: Label[];
  trees: ViewTree[];
  /**
   * How many matches the trees show, each once: of the issues the search
   * returned, those that carry every label of the label filter, or all of
   * them without one.
   */
  matchesShown: number;
  /**
   * How many issues the search returned, each once, as far as it has run:
   * the view's scope. Pull requests are not among them.
   */
  inScope: number;
  /**
   * Whether the matches' parent issues and sub-issues are being read, once
   * the search has answered.
   */
  readingContext: boolean;
  /**
   * How many issues and pull requests GitHub counts as matches, once the
   * search has run; pull requests are not listed.
   */
  matchCount: number | undefined;
  /**
   * How many of the matches GitHub answered with are pull requests, which
   * are not listed; a search says `is:issue` to leave them out.
   */
  pullRequests: number;
  /**
   * Whether the matches are all the search's matches: every page was read,
   * GitHub counts at most 1,000, the most its search returns, and it did not
   * report its results incomplete. Only then are context issues known not
   * to match.
   */
  complete: boolean;
  /** Whether GitHub reported that it did not return all matches. */
  incomplete: boolean;
  /**
   * The page of up to 100 matches being read, while the search runs, and
   * how many pages it reads, once the first has told GitHub's total: as many
   * as hold it, up to 10, the 1,000-match ceiling.
   */
  searching: { page: number; pages: number | undefined } | undefined;
  /** Why GitHub failed the search, when that says more than `loading`. */
  searchProblem: SearchProblem | undefined;
  /**
   * How far the search has run, and how current its matches are. It is
   * loading until every page of the first run has been read, the matches
   * of those read so far showing meanwhile. It failed when GitHub rejected
   * the search or it could not be run, with nothing to show from before.
   */
  loading: LoadingState;
}

/**
 * Why GitHub failed a view's search, beyond failing to answer:
 *
 * - `invalid`: it rejected the search (HTTP 422), with its message. The
 *   search is not run again on its own until it changes.
 * - `unsearchable`: it cannot search a repository or user the search names,
 *   e.g. one that does not exist or this account cannot read, with its
 *   message; likewise not run again.
 * - `too-large`: it failed with an empty HTTP 500, as it does a very long
 *   search. The search runs again on Retry.
 */
export type SearchProblem =
  { kind: "invalid" | "unsearchable"; message: string } | { kind: "too-large" };

/** Metadata read when an issue page is opened. */
export interface IssueMetadata {
  stateReason:
    "completed" | "not-planned" | "reopened" | "duplicate" | undefined;
  assignees: IssueActor[];
  milestone: string | undefined;
  commentCount: number;
  /**
   * Its body as GitHub renders it to HTML, empty when it has none. It is
   * untrusted: an interface sanitizes it before showing it. Read again, it
   * stays as it was when only the signatures of its media links changed.
   */
  bodyHTML: string;
}

export interface IssueActor {
  login: string;
  avatarUrl: string;
}

/** A comment on an issue. Timeline events, such as label changes, are none. */
export interface IssueComment {
  /** GitHub's node ID. */
  id: string;
  /** Who wrote it, unless their account has been deleted. */
  author: IssueActor | undefined;
  /** When it was written, as an ISO 8601 timestamp. */
  createdAt: string;
  /** Where it is on github.com. */
  url: string;
  /**
   * Its body as GitHub renders it to HTML, as an issue's: untrusted, and
   * unchanged when read again with only its media links signed anew.
   */
  bodyHTML: string;
}

/**
 * How far an issue's comments have loaded, and how current they are, as a
 * page's `loading` says; and `partial`: only some of them could be read, e.g.
 * the first 100, and the rest could not, so they show those.
 */
export type CommentsLoading =
  LoadingState | { status: "partial"; updatedAt: number; problem: Problem };

/**
 * An issue's comments, all of them, read 100 at a time without being asked
 * for more. The first time, they show as they arrive; read again, they show
 * as they were until all have been read again.
 */
export interface IssueComments {
  /** The comments, oldest first. */
  comments: IssueComment[];
  loading: CommentsLoading;
}

/** The direction followed outwards from the issue in a blocking map. */
export type BlockingSide = "blockedBy" | "blocking";

export type BlockingBadge =
  | { kind: "unloaded"; count: number }
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "paused" }
  | { kind: "failed"; problem: Problem }
  | { kind: "inaccessible"; count: number };

export type BlockingEnd =
  | { kind: "none" }
  | { kind: "unknown" }
  | { kind: "folded"; count: number }
  | { kind: "expanded" }
  | { kind: "loading"; count: number }
  | { kind: "paused" };

/** Domain layout: steps are signed, with blockers on the negative side. */
export interface BlockingMap {
  cards: {
    issue: IssueSummary;
    step: number;
    badges: Partial<Record<BlockingSide, BlockingBadge>>;
  }[];
  /** Arrows always point from the blocker to the issue that waits. */
  edges: { from: string; to: string; cycle: boolean; closed: boolean }[];
  ends: Record<BlockingSide, BlockingEnd>;
  /** Failed reads stay local to the map and can be retried with the page. */
  problems: Problem[];
}

/** An issue page, including relationships outside tracked repositories. */
export interface IssuePage {
  issueId: string;
  /**
   * The issue, once it has been read; none again once GitHub would no longer
   * show it to this account.
   */
  issue: (IssueSummary & IssueMetadata) | undefined;
  /**
   * Top-most parent first, excluding the issue itself. A parent issue that
   * has not been read ends it, with why: whatever lies above it is unknown.
   */
  ancestry: (ParentIssue & { url: string })[];
  /** The list's outline rows, in GitHub order, initially collapsed. */
  subIssues: IssueTree[];
  /** The blocking map, initially two steps each way, once the issue has loaded. */
  blockingMap?: BlockingMap;
  /** The issue's comments, once the issue has been read. */
  comments: IssueComments | undefined;
  /**
   * How far the page has loaded, and how current it is, comments included.
   * What loaded before a failure stays usable; parts that could not be read
   * show where they belong.
   */
  loading: LoadingState;
}

/**
 * A body's HTML read again for fresh links to its images and videos, or why
 * it could not be.
 */
export type RenewedMediaLinks =
  | { status: "renewed"; bodyHTML: string }
  | { status: "failed"; problem: Problem };

/** What became of looking up an issue by its repository and number. */
export type IssueLookup =
  /**
   * It is an issue, which a page can show: named `owner/name#12`, with its
   * page on github.com.
   */
  | {
      status: "found";
      issue: Pick<ParentIssue, "id" | "reference" | "title"> & { url: string };
    }
  /**
   * The number belongs to a pull request, which shares their numbers with
   * issues and which Verdandi does not show: its page on github.com.
   */
  | { status: "pull-request"; url: string }
  | { status: "failed"; problem: Problem };

/**
 * An owner the repository picker filters its suggestions by: the account
 * Verdandi reads GitHub as, or one of its known organizations.
 */
export interface PickerOwner {
  login: string;
  kind: "account" | "organization";
}

/**
 * A repository as the repository picker offers it, as far as GitHub said.
 * It can be selected unless its issues cannot be read.
 */
export interface PickerRepository {
  /** GitHub's numeric ID, which survives renames and transfers. */
  id: number;
  /** Its current address. */
  repository: RepositoryAddress;
  archived: boolean;
  /**
   * Whether it is a tracked repository already, under this name or, by its
   * ID, an earlier one.
   */
  tracked: boolean;
  /** Why it cannot be added, when its issues cannot be read. */
  unavailable: RepositoryUnavailable | undefined;
}

/** Why a repository's issues cannot be read, so that it cannot be added. */
export type RepositoryUnavailable =
  /** Its Issues are turned off (`hasIssuesEnabled: false`). */
  | { kind: "issues-disabled" }
  /**
   * GitHub shows the repository but refuses this account its issues, e.g.
   * to a token without Issues access, saying why when it does.
   */
  | { kind: "no-issue-access"; access: AccessEvidence | undefined };

/**
 * How far the picker's suggestions have loaded. They are never loaded
 * beyond `suggestionLimit` repositories.
 *
 * - `loading`: pages are still arriving; those that did are listed.
 * - `loaded`: every page arrived, or the first `suggestionLimit`
 *   repositories when `capped`.
 * - `failed`: a page could not be read; those that arrived before stay
 *   listed. This is never an empty result.
 */
export type SuggestionsLoading =
  | { status: "loading" }
  | { status: "loaded"; capped: boolean }
  | { status: "failed"; problem: Problem };

/** The most repositories the picker suggests. */
export const suggestionLimit = 1000;

/**
 * What the repository picker suggests: the repositories the account owns,
 * collaborates on or reaches as an organization member, most recently pushed
 * first. They are not every repository it can read; any other is checked by
 * its exact `owner/name` or URL.
 */
export interface RepositorySuggestions {
  /**
   * The account first, once GitHub has named it, then its known
   * organizations, alphabetically: those GitHub lists as its memberships,
   * and those owning a suggested repository, which it may list even when it
   * lists no memberships.
   */
  owners: PickerOwner[];
  repositories: PickerRepository[];
  loading: SuggestionsLoading;
  /**
   * Why GitHub left out repositories or organizations, where its answers
   * said so, e.g. an organization's SSO or OAuth App restrictions.
   */
  restrictions: AccessEvidence[];
  /**
   * Whether GitHub left out repositories or organizations it reported errors
   * about, whether or not `restrictions` names why: the suggestions are not
   * all there are, even once loaded.
   */
  incomplete: boolean;
}

/**
 * What became of checking a repository for the picker by its address: it
 * was found, and can be added unless `unavailable` says why not; or it could
 * not be checked, or GitHub would not show it to this account.
 */
export type RepositoryCheck =
  | { status: "found"; repository: PickerRepository }
  | { status: "failed"; problem: Problem };

/**
 * What became of adding one repository. Each is checked and added on its
 * own, and one that was added stays so whatever becomes of the others.
 */
export type RepositoryAddition = {
  /** The repository as it was asked for. */
  asked: RepositoryAddress;
} & (
  | {
      /**
       * It is tracked now, at the end of the Repositories section, or
       * where it was when it was tracked already under an earlier name.
       */
      status: "added";
      repository: PickerRepository;
    }
  /** It was found, but `repository.unavailable` says why it was not added. */
  | { status: "unavailable"; repository: PickerRepository }
  /**
   * It could not be checked or GitHub would not show it to this account, or
   * the settings file could not be changed.
   */
  | { status: "failed"; problem: Problem }
);

/** Normal window bounds, even while maximised; interpreted by the desktop. */
export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** Request/response calls. */
export interface CoreRequests {
  /** Machine-local window state, or none so the desktop uses its defaults. */
  getWindowState: () => Promise<WindowState | undefined>;
  /** Stores only window geometry; the desktop owns capturing and applying it. */
  saveWindowState: (state: WindowState) => Promise<void>;
  /** The remembered entry in current settings, or All if it no longer exists. */
  getSelectedSidebarEntry: () => Promise<SidebarSelection>;
  /** Remembers an entry on this machine, independently of the open issue page. */
  selectSidebarEntry: (
    entry: SidebarEntryKey | { kind: "all" },
  ) => Promise<void>;
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
  /**
   * Activates a side's edge card: explores More/Continue, stops a running
   * exploration, or folds Fewer back to two steps. Loaded data stays cached.
   * Progress arrives as issuePageChanged; the call returns at once.
   */
  activateBlockingEnd: (issueId: string, side: BlockingSide) => Promise<void>;
  /** Retries only this card's relationship list on an opened issue page. */
  retryBlockingBranch: (
    issueId: string,
    cardId: string,
    side: BlockingSide,
  ) => Promise<void>;
  /**
   * Reads a body on an opened issue page again, the issue's (`bodyId` is
   * the issue's ID) or a comment's, after one of its images or videos failed
   * to load, and answers with its HTML: GitHub's links to uploaded media
   * stop working five minutes after it signed them. The page is pushed with
   * it, even though only those signatures changed.
   *
   * Every body on the page with signed links is read in the same one
   * request, however many of their media fail: calls while it is read share
   * it, and for a minute after it, a body is answered as it was read. A body
   * without signed links has nothing to renew, and is answered as it is.
   */
  renewMediaLinks: (
    issueId: string,
    bodyId: string,
  ) => Promise<RenewedMediaLinks>;
  /**
   * Looks up an issue by its repository and number, e.g. one a link in an
   * issue's body names, so that its page can be opened, without tracking
   * its repository.
   */
  lookUpIssue: (
    repository: RepositoryAddress,
    number: number,
  ) => Promise<IssueLookup>;
  /**
   * Whether Verdandi can read GitHub, and as which account, as far as it has
   * checked; changes are pushed as `setupChanged`. The first call, or the
   * first GitHub request, starts the check at startup: gh is looked for where
   * the user chose it, then on PATH, then in well-known install locations,
   * and `gh auth status` asked about github.com. It is checked again after a
   * request fails in a way that suggests gh or its credentials stopped
   * working, such as HTTP 401, and only a confirmed failure blocks. When the
   * blocker clears, the screen shown last and the sidebar's counts are shown
   * again at once as if opened now, keeping what was loaded: what failed, or
   * is older than five minutes, is read again.
   *
   * The account changes when gh names another one, also as the window
   * regains focus, or GitHub answers a request as another one, e.g. after
   * `gh auth switch`. Then every request is cancelled, what GitHub answers
   * to one sent before is discarded, everything read as the previous account
   * is dropped, and `notice` says so; the screen shown last and the sidebar's
   * counts are read anew, with the same tracked repositories.
   */
  getSetup: () => Promise<Setup>;
  /**
   * Checks the setup again now (**Check again**): looks for gh and asks it
   * about its credentials, after any check under way.
   */
  checkSetupAgain: () => Promise<Setup>;
  /**
   * Uses a gh executable the user chose, if it is a usable gh, remembering
   * it on this machine, then checks the setup with it. It is looked for there
   * first from then on, while it stays usable.
   */
  chooseGhExecutable: (path: string) => Promise<GhChoice>;
  /**
   * What the sidebar lists, read from the settings file. Open-issue counts
   * the core does not know yet are asked for in one request for all of them,
   * without reading any issues, and arrive as `sidebarChanged`. A count that
   * could not be read is asked for again the next time.
   */
  getSidebar: () => Promise<SidebarEntries>;
  /** Re-reads settings and pushes the sidebar, including recovery status. */
  reloadSettings: () => Promise<void>;
  /** Renames an invalid file to a dated backup, then starts empty. */
  resetSettings: () => Promise<SettingsChangeResult>;
  /** Moves one entry within its section, re-reading the file before writing. */
  reorderSidebar: (
    entry: SidebarEntryKey,
    destination: SidebarDestination,
  ) => Promise<SettingsChangeResult>;
  /**
   * Opens the repository picker: its suggestions are pushed as
   * `repositorySuggestionsChanged` at once, and again as each page of them
   * arrives, and whenever the tracked repositories change while it is open.
   * Suggestions read in the last five minutes are shown again; others, or
   * those that failed, are read anew. While it is open, the picker's
   * requests go before the screen's.
   */
  openRepositoryPicker: () => Promise<void>;
  /** Closes the picker: suggestion pages not yet asked for are dropped. */
  closeRepositoryPicker: () => Promise<void>;
  /**
   * Checks a repository by its exact address, whether the picker suggests
   * it or not, following renames: whether its issues can be read.
   */
  checkRepository: (repository: RepositoryAddress) => Promise<RepositoryCheck>;
  /**
   * Checks each repository afresh and adds those whose issues can be read,
   * archived or without issues included, to the end of the Repositories
   * section, storing their IDs. One tracked already under an earlier name,
   * by its ID, takes its new name where it is. The rest are reported each
   * with why; nothing added is taken back.
   */
  addRepositories: (
    repositories: RepositoryAddress[],
  ) => Promise<RepositoryAddition[]>;
  /**
   * **Track the new owner/name**, for a tracked repository whose name now
   * belongs to a different repository: checks the repository at that name
   * afresh and, if its issues can be read, tracks it in the entry's place,
   * with its ID, instead of the one tracked before.
   */
  replaceRepository: (
    repository: TrackedRepository,
  ) => Promise<RepositoryAddition>;
  /**
   * Removes a tracked repository after the interface has confirmed it.
   * Views and cached issues stay; its list state is discarded and All is
   * updated. A removed selection moves to the next repository, the previous
   * if last, or All. Open issue pages stay, with external status updated.
   */
  removeRepository: (
    repository: TrackedRepository,
  ) => Promise<
    { ok: true; selection: SidebarSelection } | { ok: false; message: string }
  >;
  /**
   * Saves a view, after running its search once as GitHub's advanced search,
   * unless only its name changed or `force` says to save it anyway. Its
   * search is stored as given, never rewritten or limited to the tracked
   * repositories. The search's matches are handed to the view, so that
   * opening it does not search again, and its count to the sidebar.
   */
  saveView: (
    draft: ViewDraft,
    options?: { force?: boolean },
  ) => Promise<ViewSave>;
  /**
   * Removes a view after the interface has confirmed it. Tracked
   * repositories and cached issues stay. A removed selection moves to the
   * next view, the previous if last, or All.
   */
  removeView: (
    viewId: string,
  ) => Promise<
    { ok: true; selection: SidebarSelection } | { ok: false; message: string }
  >;
  /**
   * Opens a view: its current state is pushed as `viewChanged` at once, and
   * again as its search answers. Its search runs when it has not run in this
   * session, runs again in the background when its matches are older than
   * five minutes, and at once when it failed. The sidebar's counts are read
   * again too if they are older than five minutes.
   */
  openView: (viewId: string) => Promise<void>;
  /**
   * **Skip** on first launch: creates the settings file empty, so that the
   * picker does not open on its own again. An existing file is left as it
   * is.
   */
  skipRepositoryPicker: () => Promise<SettingsChangeResult>;
  /**
   * Opens a scope's list, in the state it was last switched to, open unless
   * switched. Its current state is pushed as `listChanged` at once, then
   * again as each page of its matches and each batch of the other issues it
   * shows arrives. Only the opened scope is loaded: opening it again shows
   * what is loaded or loading, and reads it again in the background when it
   * is older than five minutes, and what of it failed at once. All loads
   * every tracked repository side by side, and shares each repository's
   * issues with that repository's list, so neither reads again what the
   * other has read in the last five minutes. The sidebar's counts are read
   * again too if they are older than five minutes.
   */
  openList: (scope: Scope) => Promise<void>;
  /**
   * Switches a scope's list to its open or closed issues, and opens it in
   * that state, as `openList` does. The state lasts for the session, and
   * opening the scope's list again opens it in that state; each state keeps
   * its own list and expansion. A scope's closed issues are read only once
   * it is first switched to closed, every page of them, the list filling in
   * as they arrive.
   */
  switchState: (scope: Scope, state: IssueState) => Promise<void>;
  /**
   * Expands or collapses one issue's sub-issues in an opened scope's list or
   * view, then pushes it. Each keeps its expansion for the session.
   */
  setExpanded: (
    list: ExpandableList,
    issueId: string,
    expanded: boolean,
  ) => Promise<void>;
  /**
   * Expands or collapses every tree of an opened scope's list or view,
   * including issues that load later, then pushes it.
   */
  setAllExpanded: (list: ExpandableList, expanded: boolean) => Promise<void>;
  /**
   * Adds a label to the label filter of a scope's list, in both its states,
   * or of a view, unless it has one of that name already, whatever the case
   * and whichever repository it comes from; then pushes the list if it has
   * been opened. The label filter narrows the list to what has been read,
   * and asks GitHub nothing. It lasts for the session.
   */
  addLabelToFilter: (list: ExpandableList, label: Label) => Promise<void>;
  /**
   * Removes the label of a name, whatever the case, from a list's label
   * filter, then pushes the list if it has been opened.
   */
  removeLabelFromFilter: (list: ExpandableList, name: string) => Promise<void>;
  /**
   * Removes every label from a list's label filter, then pushes the list if
   * it has been opened.
   */
  clearLabelFilter: (list: ExpandableList) => Promise<void>;
  /**
   * Reads everything on screen again now, however recently it was read: the
   * sidebar's counts, and the screen the main area shows, if any, pushing
   * them as they change. What they have shows meanwhile. A list reads its
   * repositories' issues in its state and the other issues it shows, with the
   * sub-issues of expanded ones; those of collapsed ones are read again once
   * they show.
   */
  refresh: (screen: Screen | undefined) => Promise<void>;
  /**
   * What is on screen is shown again, e.g. as the window regains focus: the
   * sidebar's counts, and the screen the main area shows, if any, once
   * opened. What is older than five minutes is read again in the background,
   * as opening a screen would, and what failed or GitHub would not show, at
   * once, however recently. gh is asked which account it reads GitHub as,
   * too, unless it was asked in the last minute, to follow it to another.
   */
  revalidate: (screen: Screen | undefined) => Promise<void>;
  /**
   * Reads again now what is on screen that failed, GitHub would not show, or
   * left out: the sidebar's counts that failed, and the parts of the screen
   * the main area shows, if any, once opened. What was read shows meanwhile.
   * Failures GitHub's server may recover from are tried again twice on their
   * own; the rest, such as failing to reach GitHub, wait for this, for the
   * screen to be opened again, or for the window to regain focus.
   */
  retry: (screen: Screen | undefined) => Promise<void>;
  /**
   * Every rate-limit pool that holds requests back, and how; changes are
   * pushed as `rateLimitsChanged`.
   */
  getRateLimits: () => Promise<RateLimitState[]>;
  /**
   * `config.toml` as it is now: how Verdandi looks, and what in the file it
   * cannot use. Changes to the file are pushed as `configChanged`.
   */
  getConfig: () => Promise<ConfigState>;
  /**
   * Writes each value given to `config.toml` under its key, as the settings
   * dialog changes one. Nothing else in the file changes: the user's
   * comments, key order and formatting stay as they are, and a value that
   * cannot be used is replaced. Without a file, it creates the file, and its
   * folder, holding only these keys. While the file cannot be read as TOML,
   * nothing is written. The new state is pushed as `configChanged` at once.
   */
  changeConfig: (change: Partial<Config>) => Promise<ConfigChangeResult>;
}

/** Events the core pushes, by name, with their payloads. */
export interface CoreEvents {
  /** The setup, whenever it changes. */
  setupChanged: Setup;
  /** Something to tell the user briefly, as it happens. */
  notice: Notice;
  /** A list's state, when it is opened and whenever it changes. */
  listChanged: IssueList;
  /** An issue page's state, when it is opened and whenever it changes. */
  issuePageChanged: IssuePage;
  /** A view's state, when it is opened and whenever it changes. */
  viewChanged: ViewList;
  /**
   * The sidebar whenever settings or an open-issue count change: on hand
   * edits, writes and recovery, as counts arrive, and when a list loads.
   */
  sidebarChanged: SidebarEntries;
  /**
   * Every rate-limit pool that holds requests back, whenever that changes:
   * as a pool pauses or goes on, and as its budget falls below a tenth or
   * GitHub resets it.
   */
  rateLimitsChanged: RateLimitState[];
  /** The repository picker's suggestions, while it is open, as they change. */
  repositorySuggestionsChanged: RepositorySuggestions;
  /**
   * `config.toml` whenever it changes, including when it is created, deleted
   * or replaced.
   */
  configChanged: ConfigState;
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
  getWindowState: true,
  saveWindowState: true,
  getSelectedSidebarEntry: true,
  selectSidebarEntry: true,
  openIssuePage: true,
  activateBlockingEnd: true,
  retryBlockingBranch: true,
  renewMediaLinks: true,
  lookUpIssue: true,
  getSetup: true,
  checkSetupAgain: true,
  chooseGhExecutable: true,
  getSidebar: true,
  reloadSettings: true,
  resetSettings: true,
  reorderSidebar: true,
  openList: true,
  switchState: true,
  setExpanded: true,
  setAllExpanded: true,
  addLabelToFilter: true,
  removeLabelFromFilter: true,
  clearLabelFilter: true,
  refresh: true,
  revalidate: true,
  retry: true,
  getRateLimits: true,
  openRepositoryPicker: true,
  closeRepositoryPicker: true,
  checkRepository: true,
  addRepositories: true,
  removeRepository: true,
  replaceRepository: true,
  skipRepositoryPicker: true,
  saveView: true,
  removeView: true,
  openView: true,
  getConfig: true,
  changeConfig: true,
};
const events: Record<CoreEventName, true> = {
  setupChanged: true,
  notice: true,
  listChanged: true,
  issuePageChanged: true,
  viewChanged: true,
  sidebarChanged: true,
  rateLimitsChanged: true,
  repositorySuggestionsChanged: true,
  configChanged: true,
};

/** Every request name, for wiring the contract to a transport. */
export const requestNames = Object.keys(requests) as (keyof CoreRequests)[];

/** Every event name, for wiring the contract to a transport. */
export const eventNames = Object.keys(events) as CoreEventName[];
