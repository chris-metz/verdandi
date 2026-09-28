import type {
  OpenIssueCount,
  RepositoryAddress,
  SidebarEntries,
} from "./contract.ts";
import { inBatches } from "./batches.ts";
import type { GitHubResult, RepositorySummary } from "./github/port.ts";
import {
  atOrAfter,
  fiveMinutesAgo,
  type Clock,
  type Moment,
} from "./moments.ts";
import {
  distinctRepositories,
  nameWithOwner,
  repositoryKey,
  sameRepository,
} from "./repository-address.ts";
import { describeRequestError } from "./problems.ts";
import type { RequestResult, SendRequest } from "./request-queue.ts";
import type { SettingsStorage } from "./settings/port.ts";

/**
 * The sidebar: the tracked repositories from the settings file, with their
 * open-issue counts. Counts are read many repositories at a time and without
 * their issues: when the sidebar is read, again when it is refreshed, when
 * they are older than five minutes as a screen opens or is shown again, and
 * when reading them failed, as a screen is retried, opened or shown again.
 * A count also follows the repository's open issues each time they load, for
 * its list or for All. A known count stays shown while it is read again.
 * While the rate-limit budget is low, known counts are read again only on a
 * refresh.
 */
export interface Sidebar {
  /**
   * Reads the sidebar from the settings file, and asks GitHub for the counts
   * it does not know or that are older than five minutes, unless it is
   * already asking for them.
   */
  read(): Promise<SidebarEntries>;
  /**
   * Reads the sidebar as `read` does, and pushes it at once, before any
   * count it asks for arrives, e.g. in place of counts read as another
   * account.
   */
  reload(): void;
  /**
   * Asks GitHub again for the counts that failed, and the known ones that
   * are older than five minutes, of the sidebar as last read.
   */
  revalidate(): void;
  /** Asks GitHub again for every count of the sidebar as last read. */
  refresh(): void;
  /** Asks GitHub again for the counts that failed, of the sidebar as last read. */
  retry(): void;
  /**
   * Takes a repository's open-issue count from its open issues, just loaded,
   * with when their read started.
   */
  openIssuesLoaded(
    repository: RepositoryAddress,
    openIssues: number,
    readAt: Moment,
  ): void;
}

export interface SidebarOptions {
  settings: SettingsStorage;
  request: SendRequest;
  clock: Clock;
  /**
   * Whether what is outdated may be read again on its own, which it may not
   * while the rate-limit budget is low.
   */
  mayRevalidate: () => boolean;
  /** Pushes the sidebar to the interfaces. */
  push: (sidebar: SidebarEntries) => void;
}

/**
 * At most this many repositories are counted in one request. Tens of tracked
 * repositories, the workload Verdandi is designed for, take one.
 */
const repositoriesPerRequest = 100;

/** What a repository missing from GitHub's answer counts as. */
const unanswered: GitHubResult<RepositorySummary> = {
  ok: false,
  error: { kind: "unexpected-response" },
};

/** A repository's count, and how it was read. */
interface Count {
  count: OpenIssueCount;
  /** When GitHub was asked for the count, once it is known. */
  readAt: Moment | undefined;
  /** Whether GitHub is being asked for it. */
  asking: boolean;
}

export function createSidebar({
  settings,
  request,
  clock,
  mayRevalidate,
  push,
}: SidebarOptions): Sidebar {
  /** Each repository's count, by `repositoryKey`. */
  const counts = new Map<string, Count>();
  /** The tracked repositories as last read: what a push lists. */
  let tracked: RepositoryAddress[] | undefined;

  function countOf(repository: RepositoryAddress): OpenIssueCount {
    return (
      counts.get(repositoryKey(repository))?.count ?? { status: "loading" }
    );
  }

  function entries(repositories: RepositoryAddress[]): SidebarEntries {
    return {
      status: "read",
      all: { openIssues: allCount(repositories, countOf) },
      repositories: repositories.map((repository) => ({
        repository,
        openIssues: countOf(repository),
      })),
    };
  }

  function pushTracked() {
    if (tracked) push(entries(tracked));
  }

  /**
   * Whether a count is known, but older than five minutes, and so read again
   * on its own, unless the rate-limit budget is low.
   */
  function dueAgain(repository: RepositoryAddress): boolean {
    const readAt = counts.get(repositoryKey(repository))?.readAt;
    return (
      readAt !== undefined &&
      !atOrAfter(readAt, fiveMinutesAgo(clock)) &&
      mayRevalidate()
    );
  }

  /** Whether reading a count failed. */
  function failed(repository: RepositoryAddress): boolean {
    return countOf(repository).status === "failed";
  }

  /** Whether a count is unknown, or due to be read again. */
  function unknownOrDue(repository: RepositoryAddress): boolean {
    return countOf(repository).status !== "known" || dueAgain(repository);
  }

  /**
   * Asks GitHub for repositories' counts that it is not already asking for,
   * and says whether any count shown changed: an unknown one is now loading.
   */
  function ask(repositories: readonly RepositoryAddress[]): boolean {
    const asked: RepositoryAddress[] = [];
    let changed = false;
    for (const repository of distinctRepositories(repositories)) {
      const key = repositoryKey(repository);
      const count = counts.get(key) ?? {
        count: { status: "loading" },
        readAt: undefined,
        asking: false,
      };
      counts.set(key, count);
      if (count.asking) continue;
      count.asking = true;
      if (count.count.status === "failed") {
        count.count = { status: "loading" };
        changed = true;
      }
      asked.push(repository);
    }
    for (const batch of inBatches(asked, repositoriesPerRequest)) {
      void requestCounts(batch);
    }
    return changed;
  }

  /** Asks GitHub for some repositories' counts in one request. */
  async function requestCounts(repositories: RepositoryAddress[]) {
    const askedAt = clock();
    const result = await request(
      "fetchRepositorySummaries",
      [repositories],
      () => "background",
    );
    let changed = false;
    for (const [index, repository] of repositories.entries()) {
      const count = counts.get(repositoryKey(repository));
      if (!count) continue;
      count.asking = false;
      // Open issues that loaded meanwhile gave a count at least as recent.
      if (count.readAt && atOrAfter(count.readAt, askedAt)) continue;
      // Each repository fails on its own, unless the whole request did.
      const summary: RequestResult<RepositorySummary> = result.ok
        ? (result.value[index] ?? unanswered)
        : result;
      const answer: OpenIssueCount = summary.ok
        ? { status: "known", count: summary.value.openIssueCount }
        : { status: "failed", message: describeRequestError(summary.error) };
      if (!sameCount(count.count, answer)) changed = true;
      count.count = answer;
      count.readAt = summary.ok ? askedAt : undefined;
    }
    if (changed) pushTracked();
  }

  /**
   * Reads the tracked repositories from the settings file, and asks GitHub
   * for the counts it does not know or that are older than five minutes;
   * when `announce` says so, pushes the sidebar before any of them arrives.
   */
  async function read({
    announce,
  }: {
    announce: boolean;
  }): Promise<SidebarEntries> {
    const result = await settings.read();
    let listed: SidebarEntries;
    if (result.ok) {
      tracked = result.value.repositories;
      ask(tracked.filter(unknownOrDue));
      listed = entries(tracked);
    } else {
      tracked = undefined;
      listed = { status: "failed", message: result.message };
    }
    if (announce) push(listed);
    return listed;
  }

  return {
    read() {
      return read({ announce: false });
    },
    reload() {
      void read({ announce: true });
    },
    revalidate() {
      if (tracked && ask(tracked.filter((one) => failed(one) || dueAgain(one))))
        pushTracked();
    },
    refresh() {
      if (tracked && ask(tracked)) pushTracked();
    },
    retry() {
      if (tracked && ask(tracked.filter(failed))) pushTracked();
    },
    openIssuesLoaded(repository, openIssues, readAt) {
      const key = repositoryKey(repository);
      const known = counts.get(key);
      // A count GitHub was asked for later is at least as recent.
      if (known?.readAt && atOrAfter(known.readAt, readAt)) return;
      const count: OpenIssueCount = { status: "known", count: openIssues };
      const changed = !known || !sameCount(known.count, count);
      counts.set(key, { count, readAt, asking: known?.asking ?? false });
      if (
        changed &&
        tracked?.some((entry) => sameRepository(entry, repository))
      ) {
        pushTracked();
      }
    },
  };
}

/** Whether two counts show the same, so that the sidebar need not be pushed. */
function sameCount(a: OpenIssueCount, b: OpenIssueCount): boolean {
  if (a.status === "known" && b.status === "known") return a.count === b.count;
  if (a.status === "failed" && b.status === "failed") {
    return a.message === b.message;
  }
  return a.status === b.status;
}

/**
 * All's count: every tracked repository's together, each repository counted
 * once however often the settings file lists it. It is unknown while any of
 * theirs is, and then names the repositories whose count failed.
 */
function allCount(
  repositories: readonly RepositoryAddress[],
  countOf: (repository: RepositoryAddress) => OpenIssueCount,
): OpenIssueCount {
  let total = 0;
  let loading = false;
  const failures: string[] = [];
  for (const repository of distinctRepositories(repositories)) {
    const count = countOf(repository);
    if (count.status === "known") total += count.count;
    else if (count.status === "loading") loading = true;
    else {
      failures.push(`${nameWithOwner(repository)}: ${count.message}`);
    }
  }
  if (failures.length > 0) {
    return { status: "failed", message: failures.join("\n") };
  }
  return loading ? { status: "loading" } : { status: "known", count: total };
}
