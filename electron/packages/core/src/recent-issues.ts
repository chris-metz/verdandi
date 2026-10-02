import type { CoreRequests } from "./contract.ts";
import type { LocalStateStorage } from "./settings/port.ts";

/** How many recent issues are kept. */
const kept = 20;

/**
 * Keeps the issues opened last on this machine, newest first, each once,
 * apart from the account GitHub is read as.
 */
export function createRecentIssues(
  localState: LocalStateStorage,
): Pick<CoreRequests, "getRecentIssues" | "recordRecentIssue"> {
  return {
    async getRecentIssues() {
      return ((await localState.read()).recentIssues ?? []).slice(0, kept);
    },
    recordRecentIssue({ id, repository, number, title }) {
      const issue = {
        id,
        repository: { owner: repository.owner, name: repository.name },
        number,
        title,
      };
      return localState.update(({ recentIssues = [] }) =>
        Promise.resolve({
          recentIssues: [
            issue,
            ...recentIssues.filter((recent) => recent.id !== id),
          ].slice(0, kept),
        }),
      );
    },
  };
}
