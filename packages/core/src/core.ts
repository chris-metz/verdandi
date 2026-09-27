import type { Account, Contract, CoreEvents } from "./contract.ts";
import { createEmitter } from "./emitter.ts";
import { describeGitHubError } from "./github/error-message.ts";
import type { GitHubAccess, SendRequest } from "./github/port.ts";
import { createIssueLists } from "./issue-lists.ts";
import { createIssuePages } from "./issue-pages.ts";
import { createIssueStore } from "./issue-store.ts";
import { createClock } from "./moments.ts";
import { createRequestQueue } from "./request-queue.ts";
import type { SettingsStorage } from "./settings/port.ts";
import { createSidebar } from "./sidebar.ts";

/** At most this many `gh` processes run at once. */
const maxConcurrentRequests = 4;

export interface CoreOptions {
  github: GitHubAccess;
  settings: SettingsStorage;
  /** The time, in milliseconds since the epoch: the system clock by default. */
  now?: () => number;
}

/** Creates the core, which implements the contract every interface uses. */
export function createCore({
  github,
  settings,
  now = Date.now,
}: CoreOptions): Contract {
  const events = createEmitter<CoreEvents>();
  const clock = createClock(now);
  const queue = createRequestQueue({ concurrency: maxConcurrentRequests });
  let knownAccount: Account | undefined;

  const request: SendRequest = (send) => queue.run(() => send(github));

  const sidebar = createSidebar({
    settings,
    request,
    clock,
    push: (entries) => {
      events.emit("sidebarChanged", entries);
    },
  });

  const store = createIssueStore();
  const pages = createIssuePages({
    store,
    request,
    settings,
    clock,
    push: (page) => {
      events.emit("issuePageChanged", page);
    },
  });
  const lists = createIssueLists({
    store,
    request,
    settings,
    clock,
    push: (list) => {
      events.emit("listChanged", list);
    },
    // The sidebar's count follows a repository's open issues each time they
    // have loaded, for its list or for All.
    openIssuesLoaded: (repository, openIssues, readAt) => {
      sidebar.openIssuesLoaded(repository, openIssues, readAt);
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
    openIssuePage(issueId) {
      pages.open(issueId);
      sidebar.revalidate();
      return Promise.resolve();
    },
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
      sidebar.revalidate();
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
    refresh(screen) {
      if (screen?.kind === "list") lists.refresh(screen.scope);
      if (screen?.kind === "issue") pages.refresh(screen.issueId);
      sidebar.refresh();
      return Promise.resolve();
    },
    revalidate(screen) {
      if (screen?.kind === "list") lists.revalidate(screen.scope);
      if (screen?.kind === "issue") pages.revalidate(screen.issueId);
      sidebar.revalidate();
      return Promise.resolve();
    },
    on: events.on,
  };
}
