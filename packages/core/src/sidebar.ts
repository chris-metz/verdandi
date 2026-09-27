import type {
  OpenIssueCount,
  RepositoryAddress,
  SidebarEntries,
} from "./contract.ts";
import { inBatches } from "./batches.ts";
import { describeGitHubError } from "./github/error-message.ts";
import type {
  GitHubResult,
  RepositorySummary,
  SendRequest,
} from "./github/port.ts";
import { repositoryKey, sameRepository } from "./repository-address.ts";
import type { SettingsStorage } from "./settings/port.ts";

/**
 * The sidebar: the tracked repositories from the settings file, with their
 * open-issue counts. A count is read once per session, or again after reading
 * it failed, many repositories at a time and without their issues. It then
 * follows the repository's list each time that loads.
 */
export interface Sidebar {
  /**
   * Reads the sidebar from the settings file, and asks GitHub for the counts
   * it does not know and is not already asking for.
   */
  read(): Promise<SidebarEntries>;
  /** Takes a repository's open-issue count from its list, just loaded. */
  listLoaded(repository: RepositoryAddress, openIssues: number): void;
}

export interface SidebarOptions {
  settings: SettingsStorage;
  request: SendRequest;
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

export function createSidebar({
  settings,
  request,
  push,
}: SidebarOptions): Sidebar {
  /** Each repository's count, by `repositoryKey`. */
  const counts = new Map<string, OpenIssueCount>();
  /** The tracked repositories as last read: what a push lists. */
  let tracked: RepositoryAddress[] | undefined;

  function entries(repositories: RepositoryAddress[]): SidebarEntries {
    return {
      status: "read",
      repositories: repositories.map((repository) => ({
        repository,
        openIssues: counts.get(repositoryKey(repository)) ?? {
          status: "loading",
        },
      })),
    };
  }

  function pushTracked() {
    if (tracked) push(entries(tracked));
  }

  /** Asks GitHub for some repositories' counts in one request. */
  async function requestCounts(repositories: RepositoryAddress[]) {
    const result = await request((github) =>
      github.fetchRepositorySummaries(repositories),
    );
    let changed = false;
    for (const [index, repository] of repositories.entries()) {
      const key = repositoryKey(repository);
      // A list that loaded meanwhile gave a count at least as recent.
      if (counts.get(key)?.status !== "loading") continue;
      // Each repository fails on its own, unless the whole request did.
      const summary: GitHubResult<RepositorySummary> = result.ok
        ? (result.value[index] ?? unanswered)
        : result;
      counts.set(
        key,
        summary.ok
          ? { status: "known", count: summary.value.openIssueCount }
          : { status: "failed", message: describeGitHubError(summary.error) },
      );
      changed = true;
    }
    if (changed) pushTracked();
  }

  return {
    async read() {
      const result = await settings.read();
      if (!result.ok) {
        tracked = undefined;
        return { status: "failed", message: result.message };
      }
      tracked = result.value.repositories;
      const unknown = new Map<string, RepositoryAddress>();
      for (const repository of tracked) {
        const key = repositoryKey(repository);
        const count = counts.get(key);
        if (count === undefined || count.status === "failed") {
          unknown.set(key, repository);
          counts.set(key, { status: "loading" });
        }
      }
      for (const batch of inBatches(
        [...unknown.values()],
        repositoriesPerRequest,
      )) {
        void requestCounts(batch);
      }
      return entries(tracked);
    },
    listLoaded(repository, openIssues) {
      const key = repositoryKey(repository);
      const count = counts.get(key);
      if (count?.status === "known" && count.count === openIssues) return;
      counts.set(key, { status: "known", count: openIssues });
      if (tracked?.some((entry) => sameRepository(entry, repository))) {
        pushTracked();
      }
    },
  };
}
