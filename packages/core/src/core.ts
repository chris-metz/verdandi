import type { Account, Contract, CoreEvents } from "./contract.ts";
import { createEmitter } from "./emitter.ts";
import { describeGitHubError } from "./github/error-message.ts";
import type { GitHubAccess } from "./github/port.ts";
import { createRequestQueue } from "./request-queue.ts";

/** At most this many `gh` processes run at once. */
const maxConcurrentRequests = 4;

export interface CoreOptions {
  github: GitHubAccess;
}

/** Creates the core, which implements the contract every interface uses. */
export function createCore({ github }: CoreOptions): Contract {
  const events = createEmitter<CoreEvents>();
  const queue = createRequestQueue({ concurrency: maxConcurrentRequests });
  let knownAccount: Account | undefined;

  /** Sends one GitHub request through the request queue. */
  function request<T>(send: (github: GitHubAccess) => Promise<T>): Promise<T> {
    return queue.run(() => send(github));
  }

  /** Records the account GitHub answered as, pushing a change. */
  function observeAccount(login: string): Account {
    const previous = knownAccount;
    const account: Account = { login, host: "github.com" };
    knownAccount = account;
    if (previous !== undefined && previous.login !== login) {
      events.emit("accountChanged", account);
    }
    return account;
  }

  return {
    async getAccount() {
      const result = await request((github) => github.fetchViewer());
      if (!result.ok) {
        return { status: "failed", message: describeGitHubError(result.error) };
      }
      return { status: "known", account: observeAccount(result.value.login) };
    },
    on: events.on,
  };
}
