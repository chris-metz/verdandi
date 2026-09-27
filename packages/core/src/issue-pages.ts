import type {
  IssueMetadata,
  IssuePage,
  IssueTree,
  LoadingState,
} from "./contract.ts";
import { inBatches } from "./batches.ts";
import { describeGitHubError } from "./github/error-message.ts";
import type { Issue, SendRequest } from "./github/port.ts";
import type { IssueStore } from "./issue-store.ts";
import { summarizeIssue } from "./issue-summary.ts";
import {
  atOrAfter,
  fiveMinutesAgo,
  isOutdated,
  type Clock,
  type Moment,
} from "./moments.ts";
import {
  nameWithOwner,
  repositoryKey,
  sameRepository,
} from "./repository-address.ts";
import type { SettingsStorage } from "./settings/port.ts";

/**
 * Issue pages: an issue with its metadata, ancestry and sub-issues at every
 * level, read without tracking repositories. A page is built from the one
 * store whenever it is pushed, so an issue read again elsewhere shows on it
 * too. It is kept for the session, and read again when it is refreshed, has
 * grown old, or failed.
 */
export interface IssuePages {
  /**
   * Pushes an issue page at once. If it has not loaded, loads it; if it
   * failed, or is older than five minutes, reads it again while it shows
   * what it has. It is pushed again once it has loaded.
   */
  open(issueId: string): void;
  /**
   * Reads everything an issue page shows again now, unless it is being read.
   */
  refresh(issueId: string): void;
  /** Reads an opened issue page again if it is older than five minutes. */
  revalidate(issueId: string): void;
}

export interface IssuePagesOptions {
  store: IssueStore;
  request: SendRequest;
  settings: SettingsStorage;
  clock: Clock;
  /** Pushes an issue page's current state to the interfaces. */
  push: (page: IssuePage) => void;
}

/** What an issue page has read beyond the store, and how far it is. */
interface PageState {
  issueId: string;
  /** The tracked repositories, as last read: the ones not external. */
  tracked: Set<string>;
  /** Its metadata, once read, with when GitHub was asked for it. */
  metadata: { value: IssueMetadata; readAt: Moment } | undefined;
  /**
   * What the page shows must have been read from GitHub at this moment or
   * later; anything older is read again as the page loads.
   */
  validFrom: Moment;
  /** Whether it is being read. */
  reading: boolean;
  /** Whether it was refreshed while it was being read, to be read again. */
  readAgain: boolean;
  /** Whether a read of it has completed with its issue. */
  loaded: boolean;
  /** Why its last read failed, if it did. */
  failure: string | undefined;
}

/** At most this many issues are read by ID in one request. */
const issuesPerRequest = 100;

export function createIssuePages({
  store,
  request,
  settings,
  clock,
  push,
}: IssuePagesOptions): IssuePages {
  const pages = new Map<string, PageState>();

  /** The page as the store has it now, and how far it has loaded. */
  function build(state: PageState): IssuePage {
    const { issueId, tracked, metadata } = state;
    const page: IssuePage = {
      issueId,
      issue: undefined,
      ancestry: [],
      subIssues: [],
      loading: { status: "loading" },
    };
    const issue = store.get(issueId);
    if (!issue || !metadata) {
      page.loading = loadingOf(state, undefined);
      return page;
    }
    // The page is as old as the oldest of what it shows.
    let updatedAt = Math.min(
      metadata.readAt.time,
      store.readAt(issueId)?.time ?? Infinity,
    );
    const ageWith = (other: Issue) => {
      updatedAt = Math.min(updatedAt, store.readAt(other.id)?.time ?? Infinity);
    };
    const external = (other: Issue) =>
      !tracked.has(repositoryKey(other.repository));
    const summarize = (other: Issue) =>
      summarizeIssue(other, {
        reference: sameRepository(issue.repository, other.repository)
          ? `#${String(other.number)}`
          : `${nameWithOwner(other.repository)}#${String(other.number)}`,
        external: external(other),
      });
    page.issue = { ...summarize(issue), ...metadata.value };

    const visited = new Set([issueId]);
    let parent = issue.parent && store.get(issue.parent.id);
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id);
      ageWith(parent);
      page.ancestry.unshift({
        id: parent.id,
        url: parent.url,
        reference: `${nameWithOwner(parent.repository)}#${String(parent.number)}`,
        title: parent.title,
        external: external(parent),
      });
      parent = parent.parent && store.get(parent.parent.id);
    }

    const placed = new Set([issueId]);
    function nest(parent: Issue): IssueTree[] {
      return parent.subIssues.flatMap(({ id }) => {
        if (placed.has(id)) return [];
        placed.add(id);
        const loaded = store.get(id);
        if (!loaded) return [];
        ageWith(loaded);
        return [
          {
            issue: summarize(loaded),
            expanded: false,
            parent: undefined,
            subIssues: nest(loaded),
          },
        ];
      });
    }
    page.subIssues = nest(issue);
    page.loading = loadingOf(state, updatedAt);
    return page;
  }

  /**
   * How far a page has loaded: loading until a read of it has completed,
   * then refreshing while it is read again.
   */
  function loadingOf(
    state: PageState,
    updatedAt: number | undefined,
  ): LoadingState {
    if (state.reading) {
      return state.loaded && updatedAt !== undefined
        ? { status: "refreshing", updatedAt }
        : { status: "loading" };
    }
    if (state.failure !== undefined) {
      return { status: "failed", message: state.failure };
    }
    return updatedAt === undefined
      ? { status: "loading" }
      : { status: "current", updatedAt };
  }

  /**
   * Reads a page, pushing it as it starts, once its issue has arrived, and
   * once everything has. A refresh meanwhile reads it all again.
   */
  async function load(state: PageState) {
    state.reading = true;
    push(build(state));
    for (;;) {
      state.failure = undefined;
      await read(state);
      if (!state.readAgain) break;
      state.readAgain = false;
    }
    state.reading = false;
    if (state.metadata) state.loaded = true;
    push(build(state));
  }

  /**
   * Reads the page's issue with its metadata, then its ancestry and every
   * level of its sub-issues, reading again what is older than the page
   * needs it.
   */
  async function read(state: PageState) {
    const { issueId } = state;
    const settingsRead = await settings.read();
    if (!settingsRead.ok) {
      state.failure = settingsRead.message;
      return;
    }
    state.tracked = new Set(settingsRead.value.repositories.map(repositoryKey));

    const askedAt = clock();
    const details = await request((github) =>
      github.fetchIssueDetails(issueId),
    );
    if (!details.ok) {
      state.failure = describeGitHubError(details.error);
      return;
    }
    const {
      stateReason,
      createdAt,
      author,
      assignees,
      milestone,
      commentCount,
      ...issue
    } = details.value;
    store.put([issue], askedAt);
    state.metadata = {
      value: {
        stateReason,
        createdAt,
        author,
        assignees,
        milestone,
        commentCount,
      },
      readAt: askedAt,
    };
    push(build(state));

    /** Issues asked for during this read, so none is asked for twice. */
    const attempted = new Set<string>();
    async function readIssues(ids: string[]) {
      const outdated = ids.filter((id) => {
        if (attempted.has(id)) return false;
        const readAt = store.readAt(id);
        return readAt === undefined || !atOrAfter(readAt, state.validFrom);
      });
      for (const id of outdated) attempted.add(id);
      await Promise.all(
        inBatches(outdated, issuesPerRequest).map(async (batch) => {
          const batchAskedAt = clock();
          const result = await request((github) => github.fetchIssues(batch));
          if (!result.ok) {
            state.failure ??= describeGitHubError(result.error);
            return;
          }
          store.put(result.value, batchAskedAt);
          if (batch.some((id) => !store.get(id))) {
            state.failure ??=
              "Some issues are unavailable or not accessible with this account.";
          }
        }),
      );
    }

    async function ancestry() {
      const visited = new Set([issueId]);
      let parent = issue.parent;
      while (parent && !visited.has(parent.id)) {
        visited.add(parent.id);
        await readIssues([parent.id]);
        parent = store.get(parent.id)?.parent;
      }
    }

    async function subIssues() {
      const visited = new Set([issueId]);
      let level = issue.subIssues;
      while (level.length > 0) {
        const ids = [...new Set(level.map(({ id }) => id))].filter(
          (id) => !visited.has(id),
        );
        for (const id of ids) visited.add(id);
        await readIssues(ids);
        level = ids.flatMap((id) => store.get(id)?.subIssues ?? []);
      }
    }
    await Promise.all([ancestry(), subIssues()]);
  }

  /** Reads a page again from now on, unless it is being read. */
  function refresh(state: PageState) {
    state.validFrom = clock();
    if (state.reading) state.readAgain = true;
    else void load(state);
  }

  /** Starts a page, which takes what lists have read in the last five minutes. */
  function create(issueId: string, validFrom: Moment) {
    const state: PageState = {
      issueId,
      tracked: new Set(),
      metadata: undefined,
      validFrom,
      reading: false,
      readAgain: false,
      loaded: false,
      failure: undefined,
    };
    pages.set(issueId, state);
    void load(state);
  }

  return {
    open(issueId) {
      const known = pages.get(issueId);
      if (!known) {
        create(issueId, fiveMinutesAgo(clock));
        return;
      }
      const page = build(known);
      if (page.loading.status === "failed" || isOutdated(page.loading, clock)) {
        refresh(known);
      } else push(page);
    },
    refresh(issueId) {
      const known = pages.get(issueId);
      if (known) refresh(known);
      else create(issueId, clock());
    },
    revalidate(issueId) {
      const known = pages.get(issueId);
      if (known && isOutdated(build(known).loading, clock)) refresh(known);
    },
  };
}
