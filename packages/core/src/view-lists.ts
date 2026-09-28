import type {
  LoadingState,
  Problem,
  SavedView,
  Screen,
  ViewList,
  ViewMatchCount,
} from "./contract.ts";
import type { SearchPage } from "./github/port.ts";
import { summarizeIssue } from "./issue-summary.ts";
import { atOrAfter, isOutdated, type Clock, type Moment } from "./moments.ts";
import { problemOf } from "./problems.ts";
import { repositoryKey } from "./repository-address.ts";
import {
  screenUrgency,
  type RequestResult,
  type SendRequest,
  type Urgency,
} from "./request-queue.ts";
import type { Settings } from "./settings/port.ts";

/**
 * The views' screens, one per saved view, and what their searches last
 * answered. A view's search runs when it is first opened, or is handed the
 * answer of the search Save ran; it then runs again as the view is
 * refreshed, has grown old or failed, but never on its own once GitHub
 * rejected it, until its search changes. Only the view on screen asks GitHub
 * for anything. What a view shows comes from its search text alone, never
 * from the tracked repositories, which only tell its external issues apart.
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
  /** Runs an opened view's search again if it failed, unless GitHub rejected it. */
  retry(viewId: string): void;
}

export interface ViewListsOptions {
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
}

export function createViewLists({
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

  function stateOf(viewId: string): ViewState {
    let state = states.get(viewId);
    if (!state) {
      state = {
        run: undefined,
        failure: undefined,
        searching: undefined,
        background: false,
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

  function listOf(view: SavedView): ViewList {
    const { run, failure } = currentOf(view);
    const tracked = new Set(
      (settings?.repositories ?? []).map((repository) =>
        repositoryKey(repository),
      ),
    );
    return {
      view,
      matchCount: run?.page.total,
      pullRequests: run?.page.pullRequests ?? 0,
      rejected: failure?.rejected,
      loading: loadingOf(view),
      trees: (run?.page.issues ?? []).map((match) => ({
        issue: summarizeIssue(
          { ...match, parent: undefined, subIssues: [], incomplete: undefined },
          {
            // Every row names its repository with a chip, as in All.
            reference: `#${String(match.number)}`,
            external: !tracked.has(repositoryKey(match.repository)),
          },
        ),
        subIssues: [],
        expanded: false,
        parent: undefined,
      })),
    };
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
        stateOf(view.id).background = false;
        if (failedRetriably(view)) void search(view, false);
      });
    },
  };
}
