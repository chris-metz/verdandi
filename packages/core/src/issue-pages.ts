import type {
  BlockingSide,
  IssueMetadata,
  IssueNode,
  IssuePage,
  IssueTree,
  LoadingState,
  Problem,
  RenewedMediaLinks,
  Screen,
  UnreadIssue,
} from "./contract.ts";
import { createBlockingMaps } from "./blocking-maps.ts";
import { inBatches } from "./batches.ts";
import { keepUnlessChanged } from "./body-html.ts";
import {
  commentBodies,
  commentsOutdated,
  noComments,
  readComments,
  replaceCommentBody,
  showComments,
  type CommentsState,
} from "./issue-comments.ts";
import type { Issue } from "./github/port.ts";
import { keepAnswer, type IssueStore } from "./issue-store.ts";
import { identifyIssue, summarizeIssue } from "./issue-summary.ts";
import { createMediaLinks, type MediaLinks } from "./media-links.ts";
import {
  atOrAfter,
  fiveMinutesAgo,
  isOutdated,
  type Clock,
  type Moment,
} from "./moments.ts";
import { problemOf } from "./problems.ts";
import {
  qualifiedReference,
  repositoryKey,
  sameRepository,
} from "./repository-address.ts";
import {
  screenUrgency,
  type ScreenPart,
  type SendRequest,
  type Urgency,
} from "./request-queue.ts";
import type { SettingsStorage } from "./settings/port.ts";

/**
 * Issue pages: an issue with its metadata, ancestry and sub-issues at every
 * level, read without tracking repositories. A page is built from the one
 * store whenever it is pushed, so an issue read again elsewhere shows on it
 * too. It is kept for the session, and read again when it is refreshed, has
 * grown old, or when what of it failed is retried, opened or shown again.
 * Only the page on screen asks GitHub for anything: its issue, ancestry and
 * sub-issues first, then the deeper levels of sub-issues, which show
 * collapsed, and, when it has grown old, all of it in the background. A page
 * left before it has loaded keeps what it has, marked interrupted where it
 * lacks something, until it shows again.
 */
export interface IssuePages {
  /** Updates external status on cached pages without reading GitHub again. */
  settingsChanged(): Promise<void>;
  /**
   * Pushes an issue page at once. If it has not loaded, loads it; if it is
   * older than five minutes, reads it again while it shows what it has;
   * otherwise reads again what of it failed. It is pushed again once it has
   * loaded.
   */
  open(issueId: string): void;
  activateBlockingEnd(issueId: string, side: BlockingSide): void;
  retryBlockingBranch(
    issueId: string,
    cardId: string,
    side: BlockingSide,
  ): void;
  requestsChanged(): void;
  leave(issueId: string): void;
  /**
   * Reads everything an issue page shows again now, unless it is being read.
   */
  refresh(issueId: string): void;
  /**
   * Reads an opened issue page again if it is older than five minutes,
   * unless the rate-limit budget is low, and otherwise what of it failed.
   */
  revalidate(issueId: string): void;
  /**
   * Reads again what of an opened issue page failed, GitHub would not show,
   * or left out, however recently.
   */
  retry(issueId: string): void;
  /**
   * Reads a body of an opened issue page again for fresh links to its
   * media, as `MediaLinks` does, and answers with it.
   */
  renewMediaLinks(issueId: string, bodyId: string): Promise<RenewedMediaLinks>;
}

export interface IssuePagesOptions {
  store: IssueStore;
  request: SendRequest;
  settings: SettingsStorage;
  clock: Clock;
  /** The screen the main area shows, if any. */
  shown: () => Screen | undefined;
  /**
   * Whether what is outdated may be read again on its own, which it may not
   * while the rate-limit budget is low.
   */
  mayRevalidate: () => boolean;
  relationshipsPaused: () => boolean;
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
  /**
   * Whether it is read again on its own, because it grew old, rather than
   * because it was asked for: from then until it is refreshed or retried.
   */
  background: boolean;
  /** Its issue's comments, as far as they have been read. */
  comments: CommentsState;
  /** The links to its bodies' media, read again as they expire. */
  media: MediaLinks;
}

/** At most this many issues are read by ID in one request. */
const issuesPerRequest = 100;

export function createIssuePages({
  store,
  request,
  settings,
  clock,
  shown,
  mayRevalidate,
  relationshipsPaused,
  push,
}: IssuePagesOptions): IssuePages {
  const pages = new Map<string, PageState>();
  const maps = createBlockingMaps(store, request, clock, relationshipsPaused);

  /** How urgently a page needs a part of what it asks for. */
  function urgencyOf(state: PageState, part: ScreenPart): Urgency | undefined {
    const screen = shown();
    const isShown =
      screen?.kind === "issue" && screen.issueId === state.issueId;
    return screenUrgency(
      { shown: isShown, background: state.background },
      part,
    );
  }

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
      comments: undefined,
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
        : qualifiedReference(other.repository, other.number);
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
        reference: qualifiedReference(reference.repository, reference.number),
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
    page.blockingMap = maps.build(issueId, (id) => {
      const related = store.get(id);
      if (!related) return undefined;
      ageWith(related);
      return summarizeIssue(related, {
        reference: referenceTo(related),
        external: external(related),
      });
    });

    const comments = state.comments.read;
    if (comments) {
      updatedAt = Math.min(updatedAt, comments.readAt.time);
      if (!atOrAfter(comments.readAt, state.validFrom)) {
        stale ??= state.comments.problem;
      }
    }
    page.comments = showComments(state.comments);
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
    // Comments to be read show as being read from the start.
    state.comments.reading = commentsOutdated(state.comments, state.validFrom);
    push(build(state));
    for (;;) {
      state.problem = undefined;
      await read(state, retrying);
      if (!state.readAgain) break;
      state.readAgain = false;
      state.comments.reading = true;
    }
    state.reading = false;
    state.comments.reading = false;
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
    state.tracked = new Set(settingsRead.value.repositories.map(repositoryKey));

    const askedAt = clock();
    const details = await request("fetchIssueDetails", [issueId], () =>
      urgencyOf(state, "visible"),
    );
    if (!details.ok) {
      state.problem = problemOf(details.error);
      store.fail([issueId], state.problem, askedAt);
      // What GitHub no longer shows this account shows no more; what could
      // not be read again, comments included, shows from before.
      if (state.problem.kind === "unavailable") {
        state.metadata = undefined;
        state.comments = noComments();
      } else if (commentsOutdated(state.comments, state.validFrom)) {
        state.comments.problem = state.problem;
      }
      return;
    }
    const {
      stateReason,
      assignees,
      milestone,
      commentCount,
      bodyHTML,
      ...issue
    } = details.value;
    store.put([issue], askedAt);
    state.metadata = {
      value: {
        stateReason,
        assignees,
        milestone,
        commentCount,
        bodyHTML: keepUnlessChanged(state.metadata?.value.bodyHTML, bodyHTML),
      },
      readAt: askedAt,
    };
    push(build(state));

    /** Issues asked for during this read, so none is asked for twice. */
    const attempted = new Set<string>();
    async function readIssues(ids: string[], part: ScreenPart) {
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
          const answer = await request("fetchIssues", [batch], () =>
            urgencyOf(state, part),
          );
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
        await readIssues([parent.id], "visible");
        parent = store.get(parent.id)?.parent;
      }
    }

    // The sub-issues show collapsed, so only the first level shows at once.
    async function subIssues() {
      const visited = new Set([issueId]);
      let level = issue.subIssues;
      let part: ScreenPart = "visible";
      while (level.length > 0) {
        const ids = [...new Set(level.map(({ id }) => id))].filter(
          (id) => !visited.has(id),
        );
        for (const id of ids) visited.add(id);
        await readIssues(ids, part);
        level = ids.flatMap((id) => store.get(id)?.subIssues ?? []);
        part = "rest";
      }
    }
    async function comments() {
      if (!commentsOutdated(state.comments, state.validFrom)) return;
      await readComments(state.comments, {
        issueId,
        request,
        clock,
        urgency: (part) => urgencyOf(state, part),
        pageArrived: () => {
          push(build(state));
        },
      });
    }
    async function blockingMap() {
      // A retained relationship list cannot refresh the cards it names when
      // its own request fails. Re-read those cards independently as well.
      await readIssues(
        maps.issueIds(issueId).filter((id) => id !== issueId),
        "visible",
      );
      await maps.load(
        issueId,
        state.validFrom,
        () => urgencyOf(state, "visible"),
        () => {
          push(build(state));
        },
      );
    }
    await Promise.all([ancestry(), subIssues(), comments(), blockingMap()]);
  }

  /**
   * Reads a page again from now on, unless it is being read: in the
   * background when it is read again on its own.
   */
  function refresh(state: PageState, background = false) {
    state.background = background;
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
   * Reads a page again in the background if it is older than five minutes,
   * unless the rate-limit budget is low, and otherwise what of it failed,
   * and says whether it does.
   */
  function revalidate(state: PageState): boolean {
    const page = build(state);
    if (!isOutdated(page.loading, clock) || !mayRevalidate()) {
      return retry(state, page);
    }
    refresh(state, true);
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
      background: false,
      comments: noComments(),
      media: createMediaLinks({
        bodies: () =>
          new Map([
            ...(state.metadata
              ? [[issueId, state.metadata.value.bodyHTML] as const]
              : []),
            ...commentBodies(state.comments),
          ]),
        replace: (bodyId, html) => {
          if (bodyId === issueId && state.metadata) {
            const { value, readAt } = state.metadata;
            state.metadata = { value: { ...value, bodyHTML: html }, readAt };
          } else replaceCommentBody(state.comments, bodyId, html);
        },
        push: () => {
          push(build(state));
        },
        request,
        clock,
        urgency: () => urgencyOf(state, "visible"),
      }),
    };
    pages.set(issueId, state);
    void load(state);
  }

  return {
    async settingsChanged() {
      const { value } = await settings.read();
      const tracked = new Set(value.repositories.map(repositoryKey));
      for (const state of pages.values()) {
        state.tracked = tracked;
        push(build(state));
      }
    },
    requestsChanged() {
      const screen = shown();
      const state = screen?.kind === "issue" && pages.get(screen.issueId);
      if (state) push(build(state));
    },
    leave(issueId) {
      maps.stop(issueId);
    },
    retryBlockingBranch(issueId, cardId, side) {
      const state = pages.get(issueId);
      if (!state || urgencyOf(state, "visible") === undefined) return;
      void maps.retry(
        issueId,
        cardId,
        side,
        state.validFrom,
        () => urgencyOf(state, "visible"),
        () => {
          push(build(state));
        },
      );
    },
    activateBlockingEnd(issueId, side) {
      const state = pages.get(issueId);
      if (!state || urgencyOf(state, "visible") === undefined) return;
      maps.activate(
        issueId,
        side,
        build(state).blockingMap?.ends[side] ?? { kind: "none" },
        state.validFrom,
        () => urgencyOf(state, "visible"),
        () => {
          push(build(state));
        },
      );
    },
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
      if (!known) return;
      // Asked for, what is read is no longer read in the background.
      known.background = false;
      retry(known, build(known));
    },
    renewMediaLinks(issueId, bodyId) {
      const known = pages.get(issueId);
      return known
        ? known.media.renew(bodyId)
        : Promise.resolve({
            status: "failed",
            problem: { kind: "interrupted" },
          });
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
  const comments = page.comments?.loading.status;
  return (
    page.loading.status === "failed" ||
    page.loading.status === "stale" ||
    comments === "failed" ||
    comments === "partial" ||
    comments === "stale" ||
    page.issue?.incomplete !== undefined ||
    page.ancestry.some(({ unread }) => unread?.status === "failed") ||
    (page.blockingMap?.problems.length ?? 0) > 0 ||
    page.subIssues.some(failedNode)
  );
}
