import type {
  LoadingState,
  Problem,
  SavedView,
  Screen,
  UnreadIssue,
  ViewList,
  ViewMatchCount,
} from "./contract.ts";
import type { IssueReference, SearchPage } from "./github/port.ts";
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
 * answer of the search Save ran; it then runs again as the view is
 * refreshed, has grown old or failed, but never on its own once GitHub
 * rejected it, until its search changes. Once it answers, the matches are
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
  /** Hands a view the answer of a search Save ran for it. */
  take(view: SavedView, answer: SearchPage, readAt: Moment): void;
  /**
   * Pushes a view at once. Runs its search if it has not run, or failed,
   * and again in the background if it is older than five minutes, unless the
   * rate-limit budget is low.
   */
  open(viewId: string): void;
  /** Runs an opened view's search again now. */
  refresh(viewId: string): void;
  /** Runs an opened view's search again as `open` would. */
  revalidate(viewId: string): void;
  /**
   * Runs an opened view's search again if it failed, unless GitHub rejected
   * it, and reads again the issues it shows that failed or GitHub answered
   * in part.
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

/** A view's search as it last answered, for the search text it ran. */
interface Run {
  query: string;
  /** When GitHub was asked. */
  readAt: Moment;
  page: SearchPage;
}

/** Why a view's search last failed, for the search text it ran. */
interface Failure {
  query: string;
  at: Moment;
  problem: Problem;
  /** GitHub's message, when it rejected the search. */
  rejected: string | undefined;
}

interface ViewState {
  run: Run | undefined;
  /** The last failure, unless the search has answered since. */
  failure: Failure | undefined;
  /** The search text being run, while it is. */
  searching: string | undefined;
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
  // Views read no repository's open issues, only issues by ID.
  const loader = createIssueLoader({
    store,
    request,
    clock,
    pagesUrgency: () => undefined,
    pageRead: () => undefined,
    openIssuesLoaded: () => undefined,
    openIssuesFailed: () => undefined,
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
      searching: state?.searching === view.query,
    };
  }

  function loadingOf(view: SavedView): LoadingState {
    const { run, failure, searching } = currentOf(view);
    if (searching) {
      return run
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
    const { run, failure } = currentOf(view);
    const tracked = new Set(
      (settings?.repositories ?? []).map((repository) =>
        repositoryKey(repository),
      ),
    );
    const { expansion } = state;
    const matches = run?.page.issues ?? [];
    const forest = buildViewForest({
      matches,
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
      matchCount: run?.page.total,
      pullRequests: run?.page.pullRequests ?? 0,
      rejected: failure?.rejected,
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

  function record(
    state: ViewState,
    query: string,
    result: RequestResult<SearchPage>,
    readAt: Moment,
  ) {
    if (result.ok) {
      // What the first run shows may have been read by other screens in
      // the last five minutes; a run after it needs it newer.
      state.validFrom = state.run ? readAt : fiveMinutesAgo(clock);
      state.requested.clear();
      state.run = { query, readAt, page: result.value };
      state.failure = undefined;
      return;
    }
    state.failure = {
      query,
      at: readAt,
      problem: problemOf(result.error),
      rejected:
        result.error.kind === "invalid-search"
          ? result.error.message
          : undefined,
    };
  }

  /** Runs a view's search, pushing the view as it starts and answers. */
  async function search(view: SavedView, background: boolean) {
    const state = stateOf(view.id);
    if (state.searching === view.query) return;
    state.searching = view.query;
    state.background = background;
    update(view.id);
    const readAt = clock();
    const result = await request(
      "searchIssues",
      [view.query, 1],
      (): Urgency | undefined =>
        screenUrgency(
          { shown: isShown(view.id), background: state.background },
          "visible",
        ),
    );
    if (states.get(view.id) !== state) return;
    if (state.searching === view.query) state.searching = undefined;
    record(state, view.query, result, readAt);
    update(view.id);
    matchesChanged();
  }

  /** Whether a view's search runs again on its own after it failed. */
  function failedRetriably(view: SavedView): boolean {
    const { failure } = currentOf(view);
    return failure !== undefined && failure.rejected === undefined;
  }

  /**
   * Runs a view's search if it never ran or failed, and in the background
   * if it grew old; otherwise pushes it as it is.
   */
  function revalidate(view: SavedView) {
    const { run, failure } = currentOf(view);
    if ((!run && !failure) || failedRetriably(view)) {
      void search(view, false);
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
      if (failure?.rejected !== undefined) {
        return { status: "rejected", message: failure.rejected };
      }
      return run
        ? { status: "known", count: run.page.total }
        : { status: "unknown" };
    },
    async check(query) {
      const readAt = clock();
      // Asked for, it is as urgent as what is on screen.
      const result = await request("searchIssues", [query, 1], () => "visible");
      return { result, readAt };
    },
    take(view, answer, readAt) {
      const state = stateOf(view.id);
      record(state, view.query, { ok: true, value: answer }, readAt);
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
        if (failedRetriably(view)) void search(view, false);
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
