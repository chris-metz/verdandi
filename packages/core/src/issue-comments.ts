import type {
  CommentsLoading,
  IssueComment,
  IssueComments,
  Problem,
} from "./contract.ts";
import { keepUnlessChanged } from "./body-html.ts";
import { atOrAfter, type Clock, type Moment } from "./moments.ts";
import { problemOf } from "./problems.ts";
import type { ScreenPart, SendRequest, Urgency } from "./request-queue.ts";

/**
 * How far an issue page has read its issue's comments. They are read all at
 * once, a page of 100 at a time: the first time, they show as they arrive;
 * read again, they show as they were until all have been read again. What
 * could be read stays when the rest could not, unless GitHub no longer shows
 * the issue.
 */
export interface CommentsState {
  /**
   * The comments shown, once read, with when GitHub was asked for the first
   * of them, and whether they are all of them.
   */
  read:
    { comments: IssueComment[]; readAt: Moment; complete: boolean } | undefined;
  /** The comments of a first read, as its pages arrive. */
  arriving: IssueComment[];
  /** Whether they are being read. */
  reading: boolean;
  /** Why they could not be read, or read again, the last time. */
  problem: Problem | undefined;
}

/** An issue's comments before any has been read. */
export function noComments(): CommentsState {
  return { read: undefined, arriving: [], reading: false, problem: undefined };
}

/** The comments as an issue page shows them. */
export function showComments(state: CommentsState): IssueComments {
  const { read, arriving, reading, problem } = state;
  if (!read) {
    return {
      comments: arriving,
      loading:
        !reading && problem
          ? { status: "failed", problem }
          : { status: "loading" },
    };
  }
  const updatedAt = read.readAt.time;
  let loading: CommentsLoading;
  if (reading) loading = { status: "refreshing", updatedAt };
  else if (!read.complete) {
    loading = {
      status: "partial",
      updatedAt,
      problem: problem ?? { kind: "interrupted" },
    };
  } else if (problem) loading = { status: "stale", updatedAt, problem };
  else loading = { status: "current", updatedAt };
  return { comments: read.comments, loading };
}

/**
 * Whether the comments are to be read: they have not all been read since
 * `validFrom`.
 */
export function commentsOutdated(
  state: CommentsState,
  validFrom: Moment,
): boolean {
  const { read } = state;
  return !read || !read.complete || !atOrAfter(read.readAt, validFrom);
}

export interface ReadCommentsOptions {
  issueId: string;
  request: SendRequest;
  clock: Clock;
  /** How urgently the page needs a part of what it asks for, if at all. */
  urgency: (part: ScreenPart) => Urgency | undefined;
  /** Called as each page of a first read arrives, but the last. */
  pageArrived: () => void;
}

/**
 * Reads all of an issue's comments, oldest first, keeping those whose body
 * differs from before only in the signatures of its media links as they
 * were.
 */
export async function readComments(
  state: CommentsState,
  { issueId, request, clock, urgency, pageArrived }: ReadCommentsOptions,
): Promise<void> {
  state.reading = true;
  const askedAt = clock();
  const comments: IssueComment[] = [];
  let after: string | undefined;
  // The first page shows at once, the others below it.
  let part: ScreenPart = "visible";
  try {
    for (;;) {
      const answer = await request("fetchIssueComments", [issueId, after], () =>
        urgency(part),
      );
      if (!answer.ok) {
        failed(state, problemOf(answer.error), comments, askedAt);
        return;
      }
      comments.push(...answer.value.comments);
      after = answer.value.nextPage;
      if (after === undefined) break;
      part = "rest";
      if (!state.read) {
        state.arriving = [...comments];
        pageArrived();
      }
    }
  } finally {
    state.reading = false;
  }
  const before = new Map(
    state.read?.comments.map((comment) => [comment.id, comment]),
  );
  state.read = {
    comments: comments.map((comment) => ({
      ...comment,
      bodyHTML: keepUnlessChanged(
        before.get(comment.id)?.bodyHTML,
        comment.bodyHTML,
      ),
    })),
    readAt: askedAt,
    complete: true,
  };
  state.arriving = [];
  state.problem = undefined;
}

/**
 * Keeps why the comments could not be read, and what shows meanwhile: what
 * was read before, else the pages that arrived. GitHub no longer showing the
 * issue leaves none.
 */
function failed(
  state: CommentsState,
  problem: Problem,
  readSoFar: IssueComment[],
  askedAt: Moment,
) {
  state.problem = problem;
  state.arriving = [];
  if (problem.kind === "unavailable") state.read = undefined;
  else if (!state.read && readSoFar.length > 0) {
    state.read = { comments: readSoFar, readAt: askedAt, complete: false };
  }
}
