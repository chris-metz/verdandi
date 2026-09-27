import type { GitHubAccess, GitHubError } from "../github/port.ts";

/** An in-memory GitHub behind the GitHub-access port, for tests. */
export interface FakeGitHub extends GitHubAccess {
  /** GitHub answers as this account from now on. */
  signInAs(login: string): void;
  /** Every request fails with this error from now on. */
  failWith(error: GitHubError): void;
  /** Requests stay unanswered until `resume`. */
  pause(): void;
  /** Answers every paused request, and later ones at once. */
  resume(): void;
  /** How many requests GitHub has received but not yet answered. */
  readonly requestsInFlight: number;
}

export function createFakeGitHub({ login }: { login: string }): FakeGitHub {
  let viewer = login;
  let failure: GitHubError | undefined;
  let paused: PromiseWithResolvers<void> | undefined;
  let requestsInFlight = 0;

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
    fetchViewer() {
      return answer(() =>
        failure
          ? { ok: false, error: failure }
          : { ok: true, value: { login: viewer } },
      );
    },
  };
}
