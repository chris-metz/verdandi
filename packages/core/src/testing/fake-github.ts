import type { GitHubAccess, GitHubError, Issue } from "../github/port.ts";

/** An in-memory GitHub behind the GitHub-access port, for tests. */
export interface FakeGitHub extends GitHubAccess {
  /** GitHub answers as this account from now on. */
  signInAs(login: string): void;
  /** Adds a repository, `owner/name`, with its open issues, newest first. */
  addRepository(nameWithOwner: string, openIssues: Issue[]): void;
  /** Every request fails with this error from now on. */
  failWith(error: GitHubError): void;
  /** Requests stay unanswered until `resume`. */
  pause(): void;
  /** Answers every paused request, and later ones at once. */
  resume(): void;
  /** How many requests GitHub has received but not yet answered. */
  readonly requestsInFlight: number;
  /** How many requests so far asked about a repository, `owner/name`. */
  requestsFor(nameWithOwner: string): number;
}

export function createFakeGitHub({
  login,
  issuesPerPage = 100,
}: {
  login: string;
  /** Page size for issue lists; GitHub's largest is 100. */
  issuesPerPage?: number;
}): FakeGitHub {
  let viewer = login;
  const repositories = new Map<string, Issue[]>();
  let failure: GitHubError | undefined;
  let paused: PromiseWithResolvers<void> | undefined;
  let requestsInFlight = 0;
  const repositoryRequests = new Map<string, number>();

  /** Receives one request and answers it once GitHub is not paused. */
  async function answer<T>(respond: () => T): Promise<T> {
    requestsInFlight++;
    await paused?.promise;
    requestsInFlight--;
    return respond();
  }

  return {
    signInAs(login) {
      viewer = login;
    },
    addRepository(nameWithOwner, openIssues) {
      repositories.set(nameWithOwner, openIssues);
    },
    failWith(error) {
      failure = error;
    },
    pause() {
      paused ??= Promise.withResolvers();
    },
    resume() {
      paused?.resolve();
      paused = undefined;
    },
    get requestsInFlight() {
      return requestsInFlight;
    },
    requestsFor(nameWithOwner) {
      return repositoryRequests.get(nameWithOwner) ?? 0;
    },
    fetchViewer() {
      return answer(() =>
        failure
          ? { ok: false, error: failure }
          : { ok: true, value: { login: viewer } },
      );
    },
    fetchOpenIssues({ owner, name }, after) {
      const nameWithOwner = `${owner}/${name}`;
      repositoryRequests.set(
        nameWithOwner,
        (repositoryRequests.get(nameWithOwner) ?? 0) + 1,
      );
      return answer(() => {
        if (failure) return { ok: false, error: failure };
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
        // The cursor is simply where the next page starts.
        const start = after === undefined ? 0 : Number(after);
        const end = start + issuesPerPage;
        return {
          ok: true,
          value: {
            issues: issues.slice(start, end),
            nextPage: end < issues.length ? String(end) : undefined,
          },
        };
      });
    },
  };
}
