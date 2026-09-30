import type {
  LoadingState,
  Problem,
  SavedView,
  Screen,
  SearchProblem,
  UnreadIssue,
  ViewList,
  ViewMatchCount,
} from "./contract.ts";
import {
  searchCeiling,
  searchPageSize,
  type IssueReference,
  type SearchMatch,
  type SearchPage,
} from "./github/port.ts";
import { createIssueLoader } from "./issue-loader.ts";
import type { IssueStore } from "./issue-store.ts";
import {
  atOrAfter,
  fiveMinutesAgo,
  isOutdated,
  type Clock,
  type Moment,
} from "./moments.ts";
import { problemOf } from "./problems.ts";
import { repositoryKey } from "./repository-address.ts";
import {
  screenUrgency,
  type RequestError,
  type RequestResult,
  type ScreenPart,
  type SendRequest,
  type Urgency,
} from "./request-queue.ts";
import type { Settings } from "./settings/port.ts";
import { buildViewForest } from "./view-forest.ts";

/**
 * The views' screens, one per saved view, and what their searches last
 * answered. A view's search runs when it is first opened, or is handed the
 * first page of the search Save ran and reads the rest as it opens; it then
 * runs again as the view is refreshed, has grown old or failed, or GitHub
 * answered it in part, but never on its own once GitHub rejected it, until
 * its search changes. It reads as many pages as hold GitHub's total, up to
 * the 1,000-match ceiling; the first run shows each page as it arrives, a
 * later one only once it has read them all. As it answers, the matches are
 * read by ID into the one issue store, for their parent issues and
 * sub-issues, then their ancestors and the sub-issues the view shows, 100
 * at a time; what would show only below collapsed issues after the rest.
 * Only the view on screen asks GitHub for anything. What a view shows comes
 * from its search text alone, never from the tracked repositories, which
 * only tell its external issues apart.
 */
export interface ViewLists {
  /**
   * Takes the saved views and tracked repositories as the settings file has
   * them now: a view whose search changed has not run, and one on screen
   * runs it.
   */
  settingsChanged(settings: Settings): void;
  /** How many matches a view's search had when it last ran. */
  matchesOf(view: SavedView): ViewMatchCount;
  /**
   * Runs a search once, as Save checks it, as urgently as what is on screen,
   * with when it started.
   */
  check(
    query: string,
  ): Promise<{ result: RequestResult<SearchPage>; readAt: Moment }>;
  /** Hands a view the first page of a search Save ran for it. */
  take(view: SavedView, answer: SearchPage, readAt: Moment): void;
  /**
   * Pushes a view at once. Runs its search if it has not run, or failed,
   * reads the rest of a run that has not read every page, and runs it again
   * in the background if it is older than five minutes, unless the
   * rate-limit budget is low.
   */
  open(viewId: string): void;
  /** Runs an opened view's search again now. */
  refresh(viewId: string): void;
  /** Runs an opened view's search again as `open` would. */
  revalidate(viewId: string): void;
  /**
   * Runs an opened view's search again if it failed, unless GitHub rejected
   * it, or GitHub answered it in part, and reads again the issues it shows
   * that failed or GitHub answered in part.
   */
  retry(viewId: string): void;
  /** Expands or collapses one issue in an opened view, and pushes it. */
  setExpanded(viewId: string, issueId: string, expanded: boolean): void;
  /** Expands or collapses every issue in an opened view, and pushes it. */
  setAllExpanded(viewId: string, expanded: boolean): void;
}

export interface ViewListsOptions {
  store: IssueStore;
  request: SendRequest;
  clock: Clock;
  /** The screen the main area shows, if any. */
  shown: () => Screen | undefined;
  /**
   * Whether what is outdated may be read again on its own, which it may not
   * while the rate-limit budget is low.
   */
  mayRevalidate: () => boolean;
  /** Reads the saved views and tracked repositories from the settings file. */
  readSettings: () => Promise<Settings>;
  /** Pushes a view's current state to the interfaces. */
  push: (list: ViewList) => void;
  /** Says that a view's match count changed, for the sidebar. */
  matchesChanged: () => void;
}

/**
 * A view's search as it last answered, for the search text it ran, as far
 * as its pages have been read.
 */
interface Run {
  query: string;
  /** When GitHub was asked for its first page. */
  readAt: Moment;
  /** GitHub's total, as the latest page counted it. */
  total: number;
  /** Whether GitHub reported any page incomplete. */
  incomplete: boolean;
  /** The matches of every page read, in the search's order. */
  matches: SearchMatch[];
  /** How many pull requests those pages matched besides. */
  pullRequests: number;
  pagesRead: number;
}

/** Why a view's search last failed, for the search text it ran. */
interface Failure {
  query: string;
  at: Moment;
  problem: Problem;
  /** Why GitHub failed the search, when that says more than `problem`. */
  searchProblem: SearchProblem | undefined;
}

/** A view's search while it runs. */
interface Search {
  query: string;
  /** The page being read. */
  page: number;
  /** How many pages it reads, once the first has told GitHub's total. */
  pages: number | undefined;
  /**
   * Whether its pages show as they are read, as those of the view's first
   * run, or of one it goes on with, do.
   */
  filling: boolean;
}

interface ViewState {
  run: Run | undefined;
  /** The last failure, unless the search has answered since. */
  failure: Failure | undefined;
  /** The search being run, while it is. */
  searching: Search | undefined;
  /**
   * Whether it runs again on its own, because it grew old, rather than
   * because it was asked for.
   */
  background: boolean;
  /**
   * The issues it shows must have been read from GitHub at this moment or
   * later; anything older is read again as it shows.
   */
  validFrom: Moment;
  /**
   * Issues asked for by ID since `validFrom`, so none is asked for twice
   * unless it is retried.
   */
  requested: Set<string>;
  /**
   * Reads of issues by ID the view waits for to show them, not counting
   * those that would show only below collapsed issues.
   */
  pendingRequests: number;
  expansion: Expansion;
}

/**
 * Which issues are expanded: those the user expanded or collapsed one by
 * one, else all or none once the user said so, else the paths to matches
 * the view expanded the first time they showed.
 */
interface Expansion {
  chosen: Map<string, boolean>;
  all: boolean | undefined;
  /** Every issue that has shown on a path to a match. */
  onPath: Set<string>;
}

export function createViewLists({
  store,
  request,
  clock,
  shown,
  mayRevalidate,
  readSettings,
  push,
  matchesChanged,
}: ViewListsOptions): ViewLists {
  const states = new Map<string, ViewState>();
  /** The settings as last read. */
  let settings: Settings | undefined;
  // Views read no repository's pages of issues, only issues by ID.
  const loader = createIssueLoader({
    store,
    request,
    clock,
    pagesUrgency: () => undefined,
    pageRead: () => undefined,
    openIssuesLoaded: () => undefined,
    issuesFailed: () => undefined,
  });

  function stateOf(viewId: string): ViewState {
    let state = states.get(viewId);
    if (!state) {
      state = {
        run: undefined,
        failure: undefined,
        searching: undefined,
        background: false,
        validFrom: fiveMinutesAgo(clock),
        requested: new Set(),
        pendingRequests: 0,
        expansion: { chosen: new Map(), all: undefined, onPath: new Set() },
      };
      states.set(viewId, state);
    }
    return state;
  }

  function viewOf(viewId: string): SavedView | undefined {
    return settings?.views.find(({ id }) => id === viewId);
  }

  function isShown(viewId: string): boolean {
    const screen = shown();
    return screen?.kind === "view" && screen.viewId === viewId;
  }

  /** The run and failure that belong to a view's current search text. */
  function currentOf(view: SavedView) {
    const state = states.get(view.id);
    const run = state?.run?.query === view.query ? state.run : undefined;
    const failure =
      state?.failure?.query === view.query &&
      (!run || atOrAfter(state.failure.at, run.readAt))
        ? state.failure
        : undefined;
    return {
      run,
      failure,
      searching:
        state?.searching?.query === view.query ? state.searching : undefined,
    };
  }

  function loadingOf(view: SavedView): LoadingState {
    const { run, failure, searching } = currentOf(view);
    if (searching) {
      return run && !searching.filling
        ? { status: "refreshing", updatedAt: run.readAt.time }
        : { status: "loading" };
    }
    if (failure) {
      return run
        ? {
            status: "stale",
            updatedAt: run.readAt.time,
            problem: failure.problem,
          }
        : { status: "failed", problem: failure.problem };
    }
    return run
      ? { status: "current", updatedAt: run.readAt.time }
      : { status: "loading" };
  }

  /**
   * Why reading an issue the view asked for failed since the view needed it,
   * if it did.
   */
  function failureOf(state: ViewState, id: string) {
    const failure = store.failure(id);
    return state.requested.has(id) &&
      failure &&
      atOrAfter(failure.at, state.validFrom)
      ? failure
      : undefined;
  }

  /** Why the view shows an issue it names only as a relationship names it. */
  function unreadIssue(state: ViewState, issue: IssueReference): UnreadIssue {
    if (loader.isReading(issue.id)) return { status: "loading" };
    const failure = failureOf(state, issue.id);
    return failure
      ? { status: "failed", problem: failure.problem }
      : { status: "loading" };
  }

  /**
   * Arranges a view's trees from its search and the store, and, while it is
   * on screen, asks for the issues they need but have not read, and for
   * those they show that are older than the view needs them: first what
   * shows, then what would show below collapsed issues.
   */
  function listOf(view: SavedView): ViewList {
    const state = stateOf(view.id);
    const { run, failure, searching } = currentOf(view);
    const complete = run !== undefined && isComplete(run);
    const tracked = new Set(
      (settings?.repositories ?? []).map((repository) =>
        repositoryKey(repository),
      ),
    );
    const { expansion } = state;
    const matches = run?.matches ?? [];
    const forest = buildViewForest({
      matches,
      complete,
      lookup: (id) => store.get(id),
      readSinceSearch: (id) => {
        const readAt = store.readAt(id);
        return (
          run !== undefined &&
          readAt !== undefined &&
          atOrAfter(readAt, run.readAt)
        );
      },
      unread: (issue) => unreadIssue(state, issue),
      isTracked: (repository) => tracked.has(repositoryKey(repository)),
      isExpanded: (id, onPath) => {
        // A path to a match expands the first time it shows, and only then.
        if (onPath) expansion.onPath.add(id);
        return (
          expansion.chosen.get(id) ?? expansion.all ?? expansion.onPath.has(id)
        );
      },
    });
    if (run && isShown(view.id)) {
      const olderThan = (id: string, since: Moment) => {
        const readAt = store.readAt(id);
        return readAt !== undefined && !atOrAfter(readAt, since);
      };
      // A match's parent issue must be as new as the search's pointer to it.
      const outdated = [
        ...forest.shownIssues.filter((id) => olderThan(id, state.validFrom)),
        ...matches.flatMap(({ id }) => (olderThan(id, run.readAt) ? [id] : [])),
      ].map((id) => ({ id }));
      const needed = [
        ...forest.missing,
        ...outdated,
        ...forest.outdatedAncestors.map((id) => ({ id })),
      ];
      const collapsedAway = ({ id }: { id: string }) =>
        forest.belowCollapsed.has(id);
      readMissing(
        view.id,
        state,
        needed.filter((issue) => !collapsedAway(issue)),
        "visible",
      );
      readMissing(view.id, state, needed.filter(collapsedAway), "rest");
    }
    return {
      view,
      matchCount: run?.total,
      pullRequests: run?.pullRequests ?? 0,
      complete,
      incomplete: run?.incomplete ?? false,
      searching: searching && { page: searching.page, pages: searching.pages },
      searchProblem: failure?.searchProblem,
      loading: loadingOf(view),
      trees: forest.trees,
      matchesShown: forest.matchesShown,
      readingContext: run !== undefined && state.pendingRequests > 0,
    };
  }

  /**
   * Reads the issues a view names but has not asked for since it needs them
   * newer, together with any other read that asks for them, as urgently as
   * the part of the view they belong to.
   */
  function readMissing(
    viewId: string,
    state: ViewState,
    missing: readonly { id: string }[],
    part: ScreenPart,
  ) {
    const ids = [
      ...new Set(
        missing.map(({ id }) => id).filter((id) => !state.requested.has(id)),
      ),
    ];
    if (ids.length === 0) return;
    for (const id of ids) state.requested.add(id);
    const urgency = (): Urgency | undefined =>
      states.get(viewId) === state
        ? screenUrgency(
            { shown: isShown(viewId), background: state.background },
            part,
          )
        : undefined;
    // Only what shows keeps the view reading its context.
    const waits = part === "visible" ? 1 : 0;
    for (const read of loader.readIssues(ids, state.validFrom, urgency)) {
      state.pendingRequests += waits;
      void read.then(() => {
        state.pendingRequests -= waits;
        update(viewId);
      });
    }
  }

  function update(viewId: string) {
    const view = viewOf(viewId);
    if (view) push(listOf(view));
  }

  /** Shows a new run from now on, in place of any before it. */
  function begin(state: ViewState, run: Run) {
    // What the first run shows may have been read by other screens in the
    // last five minutes; a run after it needs it newer.
    state.validFrom = state.run ? run.readAt : fiveMinutesAgo(clock);
    state.requested.clear();
    state.run = run;
    state.failure = undefined;
  }

  function fail(
    state: ViewState,
    query: string,
    error: RequestError,
    at: Moment,
  ) {
    state.failure = {
      query,
      at,
      problem: problemOf(error),
      searchProblem: searchProblemOf(error),
    };
  }

  /**
   * Runs a view's search, pushing the view as it starts and as each page
   * answers: from its first page, or on from the pages of a run read so far.
   */
  async function search(view: SavedView, background: boolean, from?: Run) {
    const state = stateOf(view.id);
    if (state.searching?.query === view.query) return;
    const searching: Search = {
      query: view.query,
      page: from ? from.pagesRead + 1 : 1,
      pages: from && pagesOf(from.total),
      filling: from !== undefined || currentOf(view).run === undefined,
    };
    state.searching = searching;
    state.background = background;
    update(view.id);
    const readAt = from?.readAt ?? clock();
    let read = from;
    for (;;) {
      const result = await request(
        "searchIssues",
        [view.query, searching.page],
        (): Urgency | undefined =>
          screenUrgency(
            { shown: isShown(view.id), background: state.background },
            "visible",
          ),
      );
      // A search of other text, or a view removed, took its place.
      if (states.get(view.id) !== state || state.searching !== searching) {
        return;
      }
      if (!result.ok) {
        state.searching = undefined;
        fail(state, view.query, result.error, readAt);
        break;
      }
      const first = read === undefined;
      read = withPage(read, view.query, readAt, result.value);
      const pages = pagesOf(read.total);
      const done = read.pagesRead >= pages;
      if (done) state.searching = undefined;
      // A refresh shows its pages only once it has read them all.
      if (searching.filling || done) {
        if (first || !searching.filling) begin(state, read);
        else state.run = read;
      }
      if (done) break;
      if (searching.filling && first) matchesChanged();
      searching.page = read.pagesRead + 1;
      searching.pages = pages;
      update(view.id);
    }
    update(view.id);
    matchesChanged();
  }

  /** Whether a view's search runs again on its own after it failed. */
  function failedRetriably(view: SavedView): boolean {
    const { failure } = currentOf(view);
    return failure !== undefined && !rejects(failure.searchProblem);
  }

  /**
   * Runs a view's search if it never ran or failed, reads the rest of a run
   * that has not read every page, and runs it in the background if it grew
   * old; otherwise pushes it as it is.
   */
  function revalidate(view: SavedView) {
    const { run, failure } = currentOf(view);
    if ((!run && !failure) || failedRetriably(view)) {
      void search(view, false);
    } else if (run && !failure && run.pagesRead < pagesOf(run.total)) {
      void search(view, false, run);
    } else if (rejects(failure?.searchProblem)) {
      // GitHub would reject it again until it changes, however old.
      update(view.id);
    } else if (isOutdated(loadingOf(view), clock) && mayRevalidate()) {
      void search(view, true);
    } else update(view.id);
  }

  /** Reads the settings, then does something with a view, if it exists. */
  function withView(viewId: string, act: (view: SavedView) => void) {
    void readSettings().then((read) => {
      settings = read;
      const view = viewOf(viewId);
      if (view) act(view);
    });
  }

  return {
    settingsChanged(read) {
      settings = read;
      for (const id of states.keys()) {
        if (!viewOf(id)) states.delete(id);
      }
      const screen = shown();
      if (screen?.kind === "view") {
        const view = viewOf(screen.viewId);
        if (view) revalidate(view);
      }
    },
    matchesOf(view) {
      const { run, failure } = currentOf(view);
      const problem = failure?.searchProblem;
      if (problem && rejects(problem)) {
        return { status: "rejected", message: problem.message };
      }
      return run
        ? { status: "known", count: run.total }
        : { status: "unknown" };
    },
    async check(query) {
      const readAt = clock();
      // Asked for, it is as urgent as what is on screen.
      const result = await request("searchIssues", [query, 1], () => "visible");
      return { result, readAt };
    },
    take(view, answer, readAt) {
      begin(stateOf(view.id), withPage(undefined, view.query, readAt, answer));
      matchesChanged();
    },
    open(viewId) {
      withView(viewId, revalidate);
    },
    refresh(viewId) {
      withView(viewId, (view) => {
        void search(view, false);
      });
    },
    revalidate(viewId) {
      withView(viewId, revalidate);
    },
    retry(viewId) {
      withView(viewId, (view) => {
        const state = stateOf(view.id);
        state.background = false;
        if (failedRetriably(view) || currentOf(view).run?.incomplete) {
          void search(view, false);
        }
        // Issues that failed are asked for again as the view is arranged;
        // those GitHub answered in part are neither missing nor outdated.
        const failed = [...state.requested].filter((id) =>
          failureOf(state, id),
        );
        const partial = [...state.requested].filter(
          (id) => !failureOf(state, id) && store.get(id)?.incomplete,
        );
        if (failed.length === 0 && partial.length === 0) return;
        for (const id of [...failed, ...partial]) state.requested.delete(id);
        readMissing(
          view.id,
          state,
          partial.map((id) => ({ id })),
          "visible",
        );
        update(view.id);
      });
    },
    setExpanded(viewId, issueId, expanded) {
      const state = states.get(viewId);
      if (!state) return;
      state.expansion.chosen.set(issueId, expanded);
      state.background = false;
      update(viewId);
    },
    setAllExpanded(viewId, expanded) {
      const state = states.get(viewId);
      if (!state) return;
      state.expansion.chosen.clear();
      state.expansion.all = expanded;
      state.background = false;
      update(viewId);
    },
  };
}

/**
 * How many pages a search reads: as many as hold GitHub's total, up to the
 * 1,000-match ceiling, and at least the first, which tells the total.
 */
function pagesOf(total: number): number {
  return Math.max(
    1,
    Math.ceil(Math.min(total, searchCeiling) / searchPageSize),
  );
}

/** A run with one more page read: the first page of a new one without a run. */
function withPage(
  run: Run | undefined,
  query: string,
  readAt: Moment,
  page: SearchPage,
): Run {
  return {
    query,
    readAt,
    total: page.total,
    incomplete: (run?.incomplete ?? false) || page.incomplete,
    matches: [...(run?.matches ?? []), ...page.issues],
    pullRequests: (run?.pullRequests ?? 0) + page.pullRequests,
    pagesRead: (run?.pagesRead ?? 0) + 1,
  };
}

/**
 * Whether a run has every match of its search: it read every page, GitHub
 * counts no more than its search returns, and none was reported
 * incomplete.
 */
function isComplete(run: Run): boolean {
  return (
    run.pagesRead >= pagesOf(run.total) &&
    run.total <= searchCeiling &&
    !run.incomplete
  );
}

/** Why GitHub failed a search, when that says more than the problem. */
function searchProblemOf(error: RequestError): SearchProblem | undefined {
  if (error.kind === "invalid-search") {
    return {
      kind: error.unsearchable ? "unsearchable" : "invalid",
      message: error.message,
    };
  }
  if (error.kind === "server-error" && error.emptyBody) {
    return { kind: "too-large" };
  }
  return undefined;
}

/**
 * Whether GitHub rejected a search, which it would again until the search
 * changes.
 */
function rejects(
  problem: SearchProblem | undefined,
): problem is Extract<SearchProblem, { message: string }> {
  return problem?.kind === "invalid" || problem?.kind === "unsearchable";
}
