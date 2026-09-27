import type { IssuePage, IssueTree } from "./contract.ts";
import { inBatches } from "./batches.ts";
import { describeGitHubError } from "./github/error-message.ts";
import type { Issue, SendRequest } from "./github/port.ts";
import type { IssueStore } from "./issue-store.ts";
import { summarizeIssue } from "./issue-summary.ts";
import {
  nameWithOwner,
  repositoryKey,
  sameRepository,
} from "./repository-address.ts";
import type { SettingsStorage } from "./settings/port.ts";

/** Reads only the ancestry and descendants of the requested issue. */
export function createIssuePages({
  store,
  request,
  settings,
}: {
  store: IssueStore;
  request: SendRequest;
  settings: SettingsStorage;
}) {
  const pages = new Map<string, Promise<IssuePage>>();

  async function load(issueId: string): Promise<IssuePage> {
    const page: IssuePage = {
      issueId,
      issue: undefined,
      ancestry: [],
      subIssues: [],
      failure: undefined,
    };
    const settingsRead = await settings.read();
    if (!settingsRead.ok) return { ...page, failure: settingsRead.message };
    const tracked = new Set(settingsRead.value.repositories.map(repositoryKey));
    const attempted = new Set<string>();

    async function read(ids: string[]) {
      const missing = ids.filter((id) => !store.get(id) && !attempted.has(id));
      for (const id of missing) attempted.add(id);
      await Promise.all(
        inBatches(missing, 100).map(async (batch) => {
          const result = await request((github) => github.fetchIssues(batch));
          if (!result.ok) page.failure ??= describeGitHubError(result.error);
          else {
            store.put(result.value);
            if (batch.some((id) => !store.get(id))) {
              page.failure ??=
                "Some issues are unavailable or not accessible with this account.";
            }
          }
        }),
      );
    }

    const details = await request((github) =>
      github.fetchIssueDetails(issueId),
    );
    if (!details.ok)
      return { ...page, failure: describeGitHubError(details.error) };
    const issue = details.value;
    store.put([issue]);
    const external = (other: Issue) =>
      !tracked.has(repositoryKey(other.repository));
    const summarize = (other: Issue) =>
      summarizeIssue(other, {
        reference: sameRepository(issue.repository, other.repository)
          ? `#${String(other.number)}`
          : `${nameWithOwner(other.repository)}#${String(other.number)}`,
        external: external(other),
      });
    const {
      stateReason,
      createdAt,
      author,
      assignees,
      milestone,
      commentCount,
    } = issue;
    page.issue = {
      ...summarize(issue),
      stateReason,
      createdAt,
      author,
      assignees,
      milestone,
      commentCount,
    };

    async function ancestry() {
      const visited = new Set([issueId]);
      let parent = issue.parent;
      const parents: IssuePage["ancestry"] = [];
      while (parent && !visited.has(parent.id)) {
        visited.add(parent.id);
        await read([parent.id]);
        const loaded = store.get(parent.id);
        if (!loaded) break;
        parents.push({
          id: loaded.id,
          url: loaded.url,
          reference: `${nameWithOwner(loaded.repository)}#${String(loaded.number)}`,
          title: loaded.title,
          external: external(loaded),
        });
        parent = loaded.parent;
      }
      page.ancestry = parents.reverse();
    }

    async function subIssues() {
      const visited = new Set([issueId]);
      let level = issue.subIssues;
      while (level.length > 0) {
        const ids = [...new Set(level.map(({ id }) => id))].filter(
          (id) => !visited.has(id),
        );
        for (const id of ids) visited.add(id);
        await read(ids);
        level = ids.flatMap((id) => store.get(id)?.subIssues ?? []);
      }
      const placed = new Set([issueId]);
      function nest(parent: Issue): IssueTree[] {
        return parent.subIssues.flatMap(({ id }) => {
          if (placed.has(id)) return [];
          placed.add(id);
          const loaded = store.get(id);
          return loaded
            ? [
                {
                  issue: summarize(loaded),
                  expanded: false,
                  parent: undefined,
                  subIssues: nest(loaded),
                },
              ]
            : [];
        });
      }
      page.subIssues = nest(issue);
    }
    await Promise.all([ancestry(), subIssues()]);
    return page;
  }

  return {
    get(issueId: string): Promise<IssuePage> {
      const known = pages.get(issueId);
      if (known) return known;
      const loading = load(issueId).then(
        (page) => {
          if (page.failure !== undefined) pages.delete(issueId);
          return page;
        },
        (error: unknown) => {
          pages.delete(issueId);
          throw error;
        },
      );
      pages.set(issueId, loading);
      return loading;
    },
  };
}
