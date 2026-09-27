import type { Account, Contract, CoreEvents } from "./contract.ts";
import { createEmitter } from "./emitter.ts";
import { describeGitHubError } from "./github/error-message.ts";
import type { GitHubAccess, SendRequest } from "./github/port.ts";
import { createIssueLists } from "./issue-lists.ts";
import { createIssueStore } from "./issue-store.ts";
import { createRequestQueue } from "./request-queue.ts";
import type { SettingsStorage } from "./settings/port.ts";
import { createSidebar } from "./sidebar.ts";

/** At most this many `gh` processes run at once. */
const maxConcurrentRequests = 4;

export interface CoreOptions {
  github: GitHubAccess;
  settings: SettingsStorage;
}

/** Creates the core, which implements the contract every interface uses. */
export function createCore({ github, settings }: CoreOptions): Contract {
  const events = createEmitter<CoreEvents>();
  const queue = createRequestQueue({ concurrency: maxConcurrentRequests });
  let knownAccount: Account | undefined;

  const request: SendRequest = (send) => queue.run(() => send(github));

  const sidebar = createSidebar({
    settings,
    request,
    push: (entries) => {
      events.emit("sidebarChanged", entries);
    },
  });

  const lists = createIssueLists({
    store: createIssueStore(),
    request,
    trackedRepositories: async () => {
      const result = await settings.read();
      return result.ok ? result.value.repositories : [];
    },
    push: (list) => {
      events.emit("listChanged", list);
      // The sidebar's count follows the list each time it has loaded.
      if (list.loading.status === "loaded") {
        sidebar.listLoaded(list.scope.repository, list.loading.openIssues);
      }
    },
  });

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
    getSidebar() {
      return sidebar.read();
    },
    openList(scope) {
      lists.open(scope);
      return Promise.resolve();
    },
    setExpanded(scope, issueId, expanded) {
      lists.setExpanded(scope, issueId, expanded);
      return Promise.resolve();
    },
    setAllExpanded(scope, expanded) {
      lists.setAllExpanded(scope, expanded);
      return Promise.resolve();
    },
    on: events.on,
  };
}
