import type { Label, RelationshipCount } from "../contract.ts";
import type {
  GitHubAccess,
  GitHubError,
  GitHubResult,
  Issue,
  IssueReference,
  RepositorySummary,
} from "../github/port.ts";

/**
 * A synthetic issue as a test declares it. Its node ID is `I_` and its
 * `owner/name#number`, e.g. `I_acme/api#3`.
 */
export interface FakeIssue {
  number: number;
  title: string;
  /** Open unless said otherwise. */
  state?: "open" | "closed";
  /** An ISO 8601 timestamp; the same for every issue unless said otherwise. */
  updatedAt?: string;
  labels?: Label[];
  /**
   * Its sub-issues in GitHub's order, as `owner/name#number` of issues
   * declared in any repository. Parent issues and sub-issue progress follow.
   */
  subIssues?: string[];
  blockedBy?: RelationshipCount;
  blocking?: RelationshipCount;
}

/** An in-memory GitHub behind the GitHub-access port, for tests. */
export interface FakeGitHub extends GitHubAccess {
  /** GitHub answers as this account from now on. */
  signInAs(login: string): void;
  /**
   * Adds a repository, `owner/name`, with its issues, open and closed,
   * newest first. Adding it again replaces its issues.
   */
  addRepository(nameWithOwner: string, issues: FakeIssue[]): void;
  /** Every request fails with this error from now on. */
  failWith(error: GitHubError): void;
  /**
   * Answers stay undelivered until `resume`: those of every request, or only
   * of requests to one method. GitHub still answers from what it holds when
   * a request arrives.
   */
  pause(method?: keyof GitHubAccess): void;
  /** Delivers every paused answer, and later ones at once. */
  resume(): void;
  /** How many requests GitHub has received but not yet answered. */
  readonly requestsInFlight: number;
  /** How many requests GitHub has received so far, of any kind. */
  readonly requestsReceived: number;
  /**
   * How many requests so far asked about a repository, `owner/name`: for its
   * open issues, or for issues including one of its own.
   */
  requestsFor(nameWithOwner: string): number;
}

/** When every issue was updated, unless a test says otherwise. */
const defaultUpdatedAt = "2026-09-01T12:00:00Z";

export function createFakeGitHub({
  login,
  issuesPerPage = 100,
}: {
  login: string;
  /** Page size for issue lists; GitHub's largest is 100. */
  issuesPerPage?: number;
}): FakeGitHub {
  let viewer = login;
  /** Each repository's issues, newest first, by `owner/name`. */
  const repositories = new Map<string, FakeIssue[]>();
  let failure: GitHubError | undefined;
  let paused: PromiseWithResolvers<void> | undefined;
  /** The one method whose answers are paused, or none for all. */
  let pausedMethod: keyof GitHubAccess | undefined;
  let requestsInFlight = 0;
  let requestsReceived = 0;
  /** Each repository's numeric ID, by `owner/name`. */
  const repositoryIds = new Map<string, number>();
  const repositoryRequests = new Map<string, number>();

  /**
   * Receives one request to a method and answers it as of now, delivering the
   * answer once that method is not paused.
   */
  async function answer<T>(
    method: keyof GitHubAccess,
    respond: () => GitHubResult<T>,
  ): Promise<GitHubResult<T>> {
    requestsReceived++;
    requestsInFlight++;
    const answered: GitHubResult<T> = failure
      ? { ok: false, error: failure }
      : respond();
    if ((pausedMethod ?? method) === method) await paused?.promise;
    requestsInFlight--;
    return answered;
  }

  function countRequestFor(nameWithOwner: string) {
    repositoryRequests.set(
      nameWithOwner,
      (repositoryRequests.get(nameWithOwner) ?? 0) + 1,
    );
  }

  /** A declared issue by `owner/name#number`. */
  function find(ref: string): FakeIssue | undefined {
    const [nameWithOwner = "", number] = ref.split("#");
    return repositories
      .get(nameWithOwner)
      ?.find((issue) => issue.number === Number(number));
  }

  function referenceTo(ref: string): IssueReference {
    const issue = find(ref);
    if (!issue) throw new Error(`The fake GitHub has no issue ${ref}.`);
    return {
      id: `I_${ref}`,
      repository: addressOf(ref),
      number: issue.number,
      title: issue.title,
      state: issue.state ?? "open",
    };
  }

  /** The issue as GitHub reads it, with its relationships. */
  function read(nameWithOwner: string, issue: FakeIssue): Issue {
    const ref = `${nameWithOwner}#${String(issue.number)}`;
    const subIssues = (issue.subIssues ?? []).map(referenceTo);
    let parent: IssueReference | undefined;
    for (const [repository, issues] of repositories) {
      for (const candidate of issues) {
        if (candidate.subIssues?.includes(ref)) {
          parent = referenceTo(`${repository}#${String(candidate.number)}`);
        }
      }
    }
    const blockedBy = issue.blockedBy ?? { open: 0, total: 0 };
    const blocking = issue.blocking ?? { open: 0, total: 0 };
    return {
      id: `I_${ref}`,
      repository: addressOf(nameWithOwner),
      number: issue.number,
      title: issue.title,
      state: issue.state ?? "open",
      url: `https://github.com/${nameWithOwner}/issues/${String(issue.number)}`,
      updatedAt: issue.updatedAt ?? defaultUpdatedAt,
      labels: issue.labels ?? [],
      parent,
      subIssues,
      subIssuesSummary: {
        total: subIssues.length,
        completed: subIssues.filter((sub) => sub.state === "closed").length,
      },
      issueDependenciesSummary: {
        blockedBy: blockedBy.open,
        totalBlockedBy: blockedBy.total,
        blocking: blocking.open,
        totalBlocking: blocking.total,
      },
    };
  }

  return {
    signInAs(login) {
      viewer = login;
    },
    addRepository(nameWithOwner, issues) {
      repositories.set(nameWithOwner, issues);
      if (!repositoryIds.has(nameWithOwner)) {
        repositoryIds.set(nameWithOwner, 1000001 + repositoryIds.size);
      }
    },
    failWith(error) {
      failure = error;
    },
    pause(method) {
      paused ??= Promise.withResolvers();
      pausedMethod = method;
    },
    resume() {
      paused?.resolve();
      paused = undefined;
    },
    get requestsInFlight() {
      return requestsInFlight;
    },
    get requestsReceived() {
      return requestsReceived;
    },
    requestsFor(nameWithOwner) {
      return repositoryRequests.get(nameWithOwner) ?? 0;
    },
    fetchViewer() {
      return answer("fetchViewer", () => ({
        ok: true,
        value: { login: viewer },
      }));
    },
    fetchOpenIssues({ owner, name }, after) {
      const nameWithOwner = `${owner}/${name}`;
      countRequestFor(nameWithOwner);
      return answer("fetchOpenIssues", () => {
        const issues = repositories.get(nameWithOwner);
        if (!issues) {
          return {
            ok: false,
            error: {
              kind: "graphql",
              messages: [
                `Could not resolve to a Repository with the name '${owner}/${name}'.`,
              ],
            },
          };
        }
        const open = issues.filter((issue) => issue.state !== "closed");
        // The cursor is simply where the next page starts.
        const start = after === undefined ? 0 : Number(after);
        const end = start + issuesPerPage;
        return {
          ok: true,
          value: {
            issues: open
              .slice(start, end)
              .map((issue) => read(nameWithOwner, issue)),
            closedIssueCount: issues.length - open.length,
            nextPage: end < open.length ? String(end) : undefined,
          },
        };
      });
    },
    fetchIssues(ids) {
      const refs = ids.map((id) => id.replace(/^I_/, ""));
      for (const nameWithOwner of new Set(
        refs.map((ref) => ref.split("#")[0]),
      )) {
        if (nameWithOwner) countRequestFor(nameWithOwner);
      }
      return answer("fetchIssues", () => {
        if (ids.length > 100) {
          return {
            ok: false,
            error: {
              kind: "graphql",
              messages: ["You may not request more than 100 nodes at once."],
            },
          };
        }
        const issues: Issue[] = [];
        for (const [index, ref] of refs.entries()) {
          const issue = find(ref);
          if (!issue) {
            return {
              ok: false,
              error: {
                kind: "graphql",
                messages: [
                  `Could not resolve to a node with the global id of '${String(ids[index])}'.`,
                ],
              },
            };
          }
          issues.push(read(ref.split("#")[0] ?? "", issue));
        }
        return { ok: true, value: issues };
      });
    },
    fetchRepositorySummaries(addresses) {
      return answer("fetchRepositorySummaries", () => {
        if (addresses.length > 100) {
          return {
            ok: false,
            error: {
              kind: "graphql",
              messages: ["The fake GitHub reads at most 100 repositories."],
            },
          };
        }
        return {
          ok: true,
          value: addresses.map(
            ({ owner, name }): GitHubResult<RepositorySummary> => {
              const nameWithOwner = `${owner}/${name}`;
              const issues = repositories.get(nameWithOwner);
              const id = repositoryIds.get(nameWithOwner);
              if (!issues || id === undefined) {
                return {
                  ok: false,
                  error: {
                    kind: "graphql",
                    messages: [
                      `Could not resolve to a Repository with the name '${nameWithOwner}'.`,
                    ],
                  },
                };
              }
              return {
                ok: true,
                value: {
                  id,
                  repository: { owner, name },
                  openIssueCount: issues.filter(
                    (issue) => issue.state !== "closed",
                  ).length,
                  hasIssuesEnabled: true,
                  isArchived: false,
                },
              };
            },
          ),
        };
      });
    },
  };
}

/** Splits `owner/name`, or the repository of `owner/name#number`. */
function addressOf(ref: string) {
  const [owner = "", name = ""] = ref.split("#")[0]?.split("/") ?? [];
  return { owner, name };
}
