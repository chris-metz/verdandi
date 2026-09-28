import type {
  AccessEvidence,
  IssueMetadata,
  Label,
  RelationshipCount,
  TokenSource,
} from "../contract.ts";
import type {
  AuthStatus,
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
  metadata?: Partial<IssueMetadata>;
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

/**
 * An in-memory GitHub behind the GitHub-access port, for tests, together with
 * gh's credentials for it. Reads are what the core asks GitHub about issues
 * and repositories; checks of gh's credentials, as `gh auth status` makes
 * them, count apart.
 */
export interface FakeGitHub extends GitHubAccess {
  /**
   * gh signs in as this account from now on, with its stored credentials or
   * a token from an environment variable.
   */
  signInAs(login: string, source?: TokenSource): void;
  /**
   * gh has no credentials from now on: reads fail as gh does, asking to log
   * in, without asking GitHub.
   */
  signOut(): void;
  /**
   * GitHub rejects gh's credentials from now on, e.g. once the token has
   * expired: reads fail with HTTP 401.
   */
  rejectCredentials(): void;
  /**
   * Checks of gh's credentials fail with this error from now on, confirming
   * nothing, or answer again.
   */
  failAuthStatusWith(error: GitHubError | undefined): void;
  /** How many times gh's credentials have been checked so far. */
  readonly authStatusChecks: number;
  /**
   * Adds a repository, `owner/name`, with its issues, open and closed,
   * newest first. Adding it again replaces its issues.
   */
  addRepository(nameWithOwner: string, issues: FakeIssue[]): void;
  /** Every read fails with this error from now on, or succeeds again. */
  failWith(error: GitHubError | undefined): void;
  /** The next reads fail with this error, then reads succeed again. */
  failNextWith(error: GitHubError, times?: number): void;
  /**
   * GitHub no longer shows a repository, `owner/name`, or an issue,
   * `owner/name#number`, to this account, e.g. once access to it was lost,
   * saying why when `access` is given, as for SSO. Reads of it fail as
   * unavailable, and issues naming it as a sub-issue or parent issue leave
   * it out, marked incomplete.
   */
  hide(target: string, access?: AccessEvidence): void;
  /** GitHub shows a repository or issue hidden before again. */
  reveal(target: string): void;
  /**
   * Answers stay undelivered until `resume`: those of every read, or only of
   * requests to one method, which may be `fetchAuthStatus`. GitHub still
   * answers from what it holds when a request arrives.
   */
  pause(method?: keyof GitHubAccess): void;
  /** Delivers every paused answer, and later ones at once. */
  resume(): void;
  /** How many reads GitHub has received but not yet answered. */
  readonly requestsInFlight: number;
  /** How many reads GitHub has received so far, of any kind. */
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
  let credentials: "signed-in" | "signed-out" | "rejected" = "signed-in";
  let tokenSource: TokenSource = "stored";
  let authStatusFailure: GitHubError | undefined;
  let authStatusChecks = 0;
  /** Each repository's issues, newest first, by `owner/name`. */
  const repositories = new Map<string, FakeIssue[]>();
  let failure: GitHubError | undefined;
  let nextFailure: { error: GitHubError; times: number } | undefined;
  /** What GitHub does not show this account, with why, if it says so. */
  const hidden = new Map<string, AccessEvidence | undefined>();
  let paused: PromiseWithResolvers<void> | undefined;
  /** The one method whose answers are paused, or none for all. */
  let pausedMethod: keyof GitHubAccess | undefined;
  let requestsInFlight = 0;
  let requestsReceived = 0;
  /** Each repository's numeric ID, by `owner/name`. */
  const repositoryIds = new Map<string, number>();
  const repositoryRequests = new Map<string, number>();

  /**
   * Receives one read by a method and answers it as of now, delivering the
   * answer once that method is not paused.
   */
  async function answer<T>(
    method: keyof GitHubAccess,
    respond: () => GitHubResult<T>,
  ): Promise<GitHubResult<T>> {
    requestsReceived++;
    requestsInFlight++;
    const error = credentialsError() ?? failure ?? takeNextFailure();
    const answered: GitHubResult<T> = error ? { ok: false, error } : respond();
    if ((pausedMethod ?? method) === method) await paused?.promise;
    requestsInFlight--;
    return answered;
  }

  /** The error the next read fails with, if one is to. */
  function takeNextFailure(): GitHubError | undefined {
    if (!nextFailure) return undefined;
    const { error } = nextFailure;
    if (--nextFailure.times === 0) nextFailure = undefined;
    return error;
  }

  /**
   * Whether GitHub hides a repository or issue, `owner/name` or
   * `owner/name#number`, from this account, and why it says so.
   */
  function hiding(
    ref: string,
  ): { access: AccessEvidence | undefined } | undefined {
    for (const target of [ref, ref.split("#")[0] ?? ""]) {
      if (hidden.has(target)) return { access: hidden.get(target) };
    }
    return undefined;
  }

  /** How GitHub answers a read of something it hides, and what it resolves. */
  function unavailable(ref: string, message: string): GitHubError | undefined {
    const hides = hiding(ref);
    if (!hides) return undefined;
    return {
      kind: "unavailable",
      message: hides.access?.message ?? message,
      access: hides.access,
    };
  }

  /** How a read fails, as gh reports it, while its credentials do not work. */
  function credentialsError(): GitHubError | undefined {
    switch (credentials) {
      case "signed-in":
        return undefined;
      case "signed-out":
        return {
          kind: "gh-signed-out",
          message: "To get started with GitHub CLI, please run:  gh auth login",
        };
      case "rejected":
        return { kind: "http", status: 401, message: "Bad credentials" };
    }
  }

  /** gh's credentials, as `gh auth status` reports them. */
  function authStatus(): GitHubResult<AuthStatus> {
    if (authStatusFailure) return { ok: false, error: authStatusFailure };
    switch (credentials) {
      case "signed-in":
        return {
          ok: true,
          value: { state: "signed-in", login: viewer, tokenSource },
        };
      case "signed-out":
        return { ok: true, value: { state: "signed-out" } };
      case "rejected":
        return {
          ok: true,
          value: {
            state: "rejected",
            // gh knows the login only of stored credentials.
            login: tokenSource === "stored" ? viewer : undefined,
            tokenSource,
            message: "HTTP 401: Bad credentials (https://api.github.com/)",
          },
        };
    }
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

  /**
   * The issue as GitHub reads it, with its relationships. Those GitHub hides
   * are left out, and the issue marked incomplete for them.
   */
  function read(nameWithOwner: string, issue: FakeIssue): Issue {
    const ref = `${nameWithOwner}#${String(issue.number)}`;
    let incomplete: GitHubError | undefined;
    const shown = (related: string) => {
      const error = unavailable(
        related,
        `Could not resolve to a node with the global id of 'I_${related}'.`,
      );
      incomplete ??= error;
      return !error;
    };
    const subIssues = (issue.subIssues ?? []).map(referenceTo);
    const shownSubIssues = (issue.subIssues ?? [])
      .filter(shown)
      .map(referenceTo);
    let parent: IssueReference | undefined;
    for (const [repository, issues] of repositories) {
      for (const candidate of issues) {
        const parentRef = `${repository}#${String(candidate.number)}`;
        if (candidate.subIssues?.includes(ref) && shown(parentRef)) {
          parent = referenceTo(parentRef);
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
      subIssues: shownSubIssues,
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
      incomplete,
    };
  }

  return {
    signInAs(login, source = "stored") {
      viewer = login;
      tokenSource = source;
      credentials = "signed-in";
    },
    signOut() {
      credentials = "signed-out";
    },
    rejectCredentials() {
      credentials = "rejected";
    },
    failAuthStatusWith(error) {
      authStatusFailure = error;
    },
    get authStatusChecks() {
      return authStatusChecks;
    },
    async fetchAuthStatus() {
      authStatusChecks++;
      const answered = authStatus();
      if (pausedMethod === "fetchAuthStatus") await paused?.promise;
      return answered;
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
    failNextWith(error, times = 1) {
      nextFailure = { error, times };
    },
    hide(target, access) {
      hidden.set(target, access);
    },
    reveal(target) {
      hidden.delete(target);
    },
    pause(method) {
      paused ??= Promise.withResolvers();
      pausedMethod = method;
    },
    resume() {
      paused?.resolve();
      paused = undefined;
      pausedMethod = undefined;
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
    fetchIssueDetails(id) {
      return answer("fetchIssueDetails", () => {
        const ref = id.replace(/^I_/, "");
        const issue = find(ref);
        const message = `Could not resolve to a node with the global id of '${id}'.`;
        const hides = unavailable(ref, message);
        if (hides) return { ok: false, error: hides };
        if (!issue)
          return {
            ok: false,
            error: { kind: "unavailable", message, access: undefined },
          };
        return {
          ok: true,
          value: {
            ...read(ref.split("#")[0] ?? "", issue),
            stateReason: issue.state === "closed" ? "completed" : undefined,
            createdAt: defaultUpdatedAt,
            author: undefined,
            assignees: [],
            milestone: undefined,
            commentCount: 0,
            ...issue.metadata,
          },
        };
      });
    },
    fetchOpenIssues({ owner, name }, after) {
      const nameWithOwner = `${owner}/${name}`;
      countRequestFor(nameWithOwner);
      return answer("fetchOpenIssues", () => {
        const issues = repositories.get(nameWithOwner);
        const message = `Could not resolve to a Repository with the name '${nameWithOwner}'.`;
        const hides = unavailable(nameWithOwner, message);
        if (hides) return { ok: false, error: hides };
        if (!issues) {
          return {
            ok: false,
            error: { kind: "unavailable", message, access: undefined },
          };
        }
        const open = issues.filter((issue) => issue.state !== "closed");
        // The cursor is simply where the next page starts.
        const start = after === undefined ? 0 : Number(after);
        const end = start + issuesPerPage;
        // Issues GitHub hides are left out of the page, which says so.
        let incomplete: GitHubError | undefined;
        const shown = open.slice(start, end).filter((issue) => {
          const ref = `${nameWithOwner}#${String(issue.number)}`;
          const error = unavailable(
            ref,
            `Could not resolve to a node with the global id of 'I_${ref}'.`,
          );
          incomplete ??= error;
          return !error;
        });
        return {
          ok: true,
          value: {
            issues: shown.map((issue) => read(nameWithOwner, issue)),
            closedIssueCount: issues.length - open.length,
            nextPage: end < open.length ? String(end) : undefined,
            incomplete,
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
        return {
          ok: true,
          value: refs.map((ref): GitHubResult<Issue> => {
            const issue = find(ref);
            const message = `Could not resolve to a node with the global id of 'I_${ref}'.`;
            const hides = unavailable(ref, message);
            if (hides) return { ok: false, error: hides };
            if (!issue) {
              return {
                ok: false,
                error: { kind: "unavailable", message, access: undefined },
              };
            }
            return { ok: true, value: read(ref.split("#")[0] ?? "", issue) };
          }),
        };
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
              const message = `Could not resolve to a Repository with the name '${nameWithOwner}'.`;
              const hides = unavailable(nameWithOwner, message);
              if (hides) return { ok: false, error: hides };
              if (!issues || id === undefined) {
                return {
                  ok: false,
                  error: { kind: "unavailable", message, access: undefined },
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
