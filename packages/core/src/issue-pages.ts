import type {
  IssueMetadata,
  IssueNode,
  IssuePage,
  IssueTree,
  LoadingState,
  Problem,
  UnreadIssue,
} from "./contract.ts";
import { inBatches } from "./batches.ts";
import type { Issue, SendRequest } from "./github/port.ts";
import { keepAnswer, type IssueStore } from "./issue-store.ts";
import { identifyIssue, summarizeIssue } from "./issue-summary.ts";
import {
  atOrAfter,
  fiveMinutesAgo,
  isOutdated,
  type Clock,
  type Moment,
} from "./moments.ts";
import { problemOf } from "./problems.ts";
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
 * grown old, or when what of it failed is retried, opened or shown again.
 */
export interface IssuePages {
  /**
   * Pushes an issue page at once. If it has not loaded, loads it; if it is
   * older than five minutes, reads it again while it shows what it has;
   * otherwise reads again what of it failed. It is pushed again once it has
   * loaded.
   */
  open(issueId: string): void;
  /**
   * Reads everything an issue page shows again now, unless it is being read.
   */
  refresh(issueId: string): void;
  /**
   * Reads an opened issue page again if it is older than five minutes, and
   * otherwise what of it failed.
   */
  revalidate(issueId: string): void;
  /**
   * Reads again what of an opened issue page failed, GitHub would not show,
   * or left out, however recently.
   */
  retry(issueId: string): void;
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
  /** When its latest read started. */
  readStartedAt: Moment;
  /** Whether it was refreshed while it was being read, to be read again. */
  readAgain: boolean;
  /** Issues this page is reading by ID. */
  readingIds: Set<string>;
  /** Whether a read of it has completed with its issue. */
  loaded: boolean;
  /** Why its last read of the issue itself failed, if it did. */
  problem: Problem | undefined;
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

  /**
   * Why the page shows an issue it names only as a relationship names it:
   * while the page is read, it is loading unless it failed meanwhile.
   */
  function unreadIssue(state: PageState, id: string): UnreadIssue {
    const failure = store.failure(id);
    const settled =
      failure &&
      !state.readingIds.has(id) &&
      (!state.reading || atOrAfter(failure.at, state.readStartedAt));
    return settled
      ? { status: "failed", problem: failure.problem }
      : { status: "loading" };
  }

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
      page.loading = loadingOf(state, undefined, undefined);
      return page;
    }
    // The page is as old as the oldest of what it shows, and stale if any
    // of that could not be read again.
    let updatedAt = Math.min(
      metadata.readAt.time,
      store.readAt(issueId)?.time ?? Infinity,
    );
    let stale: Problem | undefined;
    const ageWith = (other: Issue) => {
      const readAt = store.readAt(other.id);
      updatedAt = Math.min(updatedAt, readAt?.time ?? Infinity);
      if (readAt && !atOrAfter(readAt, state.validFrom)) {
        stale ??= store.failure(other.id)?.problem;
      }
    };
    const external = (other: Pick<Issue, "repository">) =>
      !tracked.has(repositoryKey(other.repository));
    const referenceTo = (other: Pick<Issue, "repository" | "number">) =>
      sameRepository(issue.repository, other.repository)
        ? `#${String(other.number)}`
        : `${nameWithOwner(other.repository)}#${String(other.number)}`;
    page.issue = {
      ...summarizeIssue(issue, {
        reference: referenceTo(issue),
        external: external(issue),
      }),
      ...metadata.value,
    };

    // A parent issue that has not been read ends the ancestry: what lies
    // above it is unknown.
    const visited = new Set([issueId]);
    let reference = issue.parent;
    while (reference && !visited.has(reference.id)) {
      visited.add(reference.id);
      const parent = store.get(reference.id);
      const presentation = {
        reference: `${nameWithOwner(reference.repository)}#${String(reference.number)}`,
        external: external(reference),
      };
      if (!parent) {
        const { id, url, title } = identifyIssue(reference, presentation);
        page.ancestry.unshift({
          id,
          url,
          title,
          ...presentation,
          unread: unreadIssue(state, reference.id),
        });
        break;
      }
      ageWith(parent);
      page.ancestry.unshift({
        id: parent.id,
        url: parent.url,
        title: parent.title,
        ...presentation,
        unread: undefined,
      });
      reference = parent.parent;
    }

    const placed = new Set([issueId]);
    function nest(parent: Issue): IssueTree[] {
      return parent.subIssues.flatMap((subIssue): IssueTree[] => {
        if (placed.has(subIssue.id)) return [];
        placed.add(subIssue.id);
        const presentation = {
          reference: referenceTo(subIssue),
          external: external(subIssue),
        };
        const loaded = store.get(subIssue.id);
        if (!loaded) {
          return [
            {
              issue: identifyIssue(subIssue, presentation),
              expanded: false,
              parent: undefined,
              subIssues: [],
              unread: unreadIssue(state, subIssue.id),
            },
          ];
        }
        ageWith(loaded);
        return [
          {
            issue: summarizeIssue(loaded, presentation),
            expanded: false,
            parent: undefined,
            subIssues: nest(loaded),
          },
        ];
      });
    }
    page.subIssues = nest(issue);
    page.loading = loadingOf(state, updatedAt, stale);
    return page;
  }

  /**
   * How far a page has loaded: loading until a read of it has completed,
   * then refreshing while it is read again. It is stale when what it shows
   * could not be read again, and failed when it has nothing to show, also
   * once GitHub would no longer show the issue.
   */
  function loadingOf(
    state: PageState,
    updatedAt: number | undefined,
    stale: Problem | undefined,
  ): LoadingState {
    if (state.reading) {
      return state.loaded && updatedAt !== undefined
        ? { status: "refreshing", updatedAt }
        : { status: "loading" };
    }
    const problem = state.problem ?? stale;
    if (updatedAt === undefined) {
      return problem ? { status: "failed", problem } : { status: "loading" };
    }
    return problem
      ? { status: "stale", updatedAt, problem }
      : { status: "current", updatedAt };
  }

  /**
   * Reads a page, pushing it as it starts, once its issue has arrived, and
   * once everything has. A refresh meanwhile reads it all again.
   */
  async function load(state: PageState, retrying = false) {
    state.reading = true;
    state.readStartedAt = clock();
    push(build(state));
    for (;;) {
      state.problem = undefined;
      await read(state, retrying);
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
   * needs it, what failed, and, when retrying, what GitHub answered only in
   * part.
   */
  async function read(state: PageState, retrying: boolean) {
    const { issueId } = state;
    const settingsRead = await settings.read();
    if (!settingsRead.ok) {
      state.problem = { kind: "error", message: settingsRead.message };
      return;
    }
    state.tracked = new Set(settingsRead.value.repositories.map(repositoryKey));

    const askedAt = clock();
    const details = await request((github) =>
      github.fetchIssueDetails(issueId),
    );
    if (!details.ok) {
      state.problem = problemOf(details.error);
      store.fail([issueId], state.problem, askedAt);
      // What GitHub no longer shows this account shows no more.
      if (state.problem.kind === "unavailable") state.metadata = undefined;
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
        return (
          readAt === undefined ||
          !atOrAfter(readAt, state.validFrom) ||
          (retrying && store.get(id)?.incomplete !== undefined)
        );
      });
      for (const id of outdated) attempted.add(id);
      await Promise.all(
        inBatches(outdated, issuesPerRequest).map(async (batch) => {
          const batchAskedAt = clock();
          for (const id of batch) state.readingIds.add(id);
          const answer = await request((github) => github.fetchIssues(batch));
          for (const id of batch) state.readingIds.delete(id);
          keepAnswer(store, batch, answer, batchAskedAt);
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

  /**
   * Reads again what of a page failed or GitHub answered only in part, and
   * says whether it does.
   */
  function retry(state: PageState, page: IssuePage): boolean {
    if (state.reading || !hasFailedParts(page)) return false;
    void load(state, true);
    return true;
  }

  /**
   * Reads a page again if it is older than five minutes, and otherwise what
   * of it failed, and says whether it does.
   */
  function revalidate(state: PageState): boolean {
    const page = build(state);
    if (!isOutdated(page.loading, clock)) return retry(state, page);
    refresh(state);
    return true;
  }

  /** Starts a page, which takes what lists have read in the last five minutes. */
  function create(issueId: string, validFrom: Moment) {
    const state: PageState = {
      issueId,
      tracked: new Set(),
      metadata: undefined,
      validFrom,
      reading: false,
      readStartedAt: validFrom,
      readAgain: false,
      readingIds: new Set(),
      loaded: false,
      problem: undefined,
    };
    pages.set(issueId, state);
    void load(state);
  }

  return {
    open(issueId) {
      const known = pages.get(issueId);
      if (!known) create(issueId, fiveMinutesAgo(clock));
      else if (!revalidate(known)) push(build(known));
    },
    refresh(issueId) {
      const known = pages.get(issueId);
      if (known) refresh(known);
      else create(issueId, clock());
    },
    revalidate(issueId) {
      const known = pages.get(issueId);
      if (known) revalidate(known);
    },
    retry(issueId) {
      const known = pages.get(issueId);
      if (known) retry(known, build(known));
    },
  };
}

/**
 * Whether a page shows anything that failed, that GitHub would not show, or
 * that it answered only in part.
 */
function hasFailedParts(page: IssuePage): boolean {
  const failedNode = (node: IssueNode): boolean =>
    node.unread
      ? node.unread.status === "failed"
      : node.issue.incomplete !== undefined || node.subIssues.some(failedNode);
  return (
    page.loading.status === "failed" ||
    page.loading.status === "stale" ||
    page.issue?.incomplete !== undefined ||
    page.ancestry.some(({ unread }) => unread?.status === "failed") ||
    page.subIssues.some(failedNode)
  );
}
