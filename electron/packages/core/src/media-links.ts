import type { Problem, RenewedMediaLinks } from "./contract.ts";
import { inBatches } from "./batches.ts";
import type { Clock, Moment } from "./moments.ts";
import { problemOf } from "./problems.ts";
import type { SendRequest, Urgency } from "./request-queue.ts";
import { hasSignedLinks } from "./signed-links.ts";

/**
 * The links to uploaded images and videos in an issue page's bodies, which
 * GitHub signs in the HTML it renders, and which stop working five minutes
 * later. Once one fails to load, the bodies are read again for fresh links:
 * every body of the page with signed links at once, in as few requests as
 * there are hundreds of them, so that the other media that fail with it
 * need no request of their own.
 */
export interface MediaLinks {
  /**
   * Reads a body again for fresh links, unless it has none to renew or was
   * read again less than a minute ago, and answers with its HTML: a body
   * being read again shares that read.
   */
  renew(bodyId: string): Promise<RenewedMediaLinks>;
}

export interface MediaLinksOptions {
  /** Every body the page shows, by ID: the issue's and its comments'. */
  bodies: () => ReadonlyMap<string, string>;
  /** Shows a body's HTML as read again, even with only its links changed. */
  replace: (bodyId: string, html: string) => void;
  /** Pushes the page once bodies have been read again. */
  push: () => void;
  request: SendRequest;
  clock: Clock;
  /** How urgently the page needs its bodies, if at all. */
  urgency: () => Urgency | undefined;
}

/** For this long after a body is read again, its links are fresh. */
const freshFor = 60 * 1000;

/** At most this many bodies are read in one request. */
const bodiesPerRequest = 100;

/** Why the bodies of a renewal that could not be read were not. */
type Failures = ReadonlyMap<string, Problem>;

export function createMediaLinks({
  bodies,
  replace,
  push,
  request,
  clock,
  urgency,
}: MediaLinksOptions): MediaLinks {
  /** The renewal each body is being read again in, by ID. */
  const renewing = new Map<string, Promise<Failures>>();
  /** Each body as last read again, and when, by ID. */
  const renewed = new Map<string, { html: string; at: Moment }>();

  /**
   * Whether a body shows as it was read again less than a minute ago, not
   * as read before or since.
   */
  function isFresh(bodyId: string, html: string): boolean {
    const last = renewed.get(bodyId);
    return (
      last !== undefined &&
      last.html === html &&
      clock().time - last.at.time < freshFor
    );
  }

  /** Reads every body with signed links again that is not fresh. */
  function renewAll(): Promise<Failures> {
    const ids = [...bodies()]
      .filter(
        ([id, html]) =>
          hasSignedLinks(html) && !renewing.has(id) && !isFresh(id, html),
      )
      .map(([id]) => id);
    const renewal = read(ids);
    for (const id of ids) renewing.set(id, renewal);
    return renewal;
  }

  async function read(ids: string[]): Promise<Failures> {
    const failures = new Map<string, Problem>();
    try {
      await Promise.all(
        inBatches(ids, bodiesPerRequest).map(async (batch) => {
          const askedAt = clock();
          const answer = await request("fetchBodyHtml", [batch], urgency);
          batch.forEach((id, index) => {
            const read = answer.ok ? answer.value[index] : answer;
            if (!read?.ok) {
              failures.set(
                id,
                problemOf(read?.error ?? { kind: "interrupted" }),
              );
              return;
            }
            replace(id, read.value);
            renewed.set(id, { html: read.value, at: askedAt });
          });
        }),
      );
    } finally {
      for (const id of ids) renewing.delete(id);
    }
    push();
    return failures;
  }

  return {
    async renew(bodyId) {
      const html = bodies().get(bodyId);
      if (html === undefined) {
        return { status: "failed", problem: { kind: "interrupted" } };
      }
      if (!hasSignedLinks(html) || isFresh(bodyId, html)) {
        return { status: "renewed", bodyHTML: html };
      }
      const failures = await (renewing.get(bodyId) ?? renewAll());
      const problem = failures.get(bodyId);
      const now = bodies().get(bodyId);
      if (problem || now === undefined) {
        return {
          status: "failed",
          problem: problem ?? { kind: "interrupted" },
        };
      }
      return { status: "renewed", bodyHTML: now };
    },
  };
}
