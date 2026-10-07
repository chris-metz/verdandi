import type {
  AccessEvidence,
  BlockingSide,
  IssueActor,
  IssueMetadata,
  Label,
  RateLimitBudget,
  RateLimitPool,
  RelationshipCount,
  RepositoryAddress,
  TokenSource,
} from "../contract.ts";
import {
  readPools,
  searchPageSize,
  type AuthStatus,
  type CommentPage,
  type GitHubAccess,
  type GitHubError,
  type GitHubRead,
  type GitHubResponse,
  type GitHubResult,
  type Issue,
  type IssuePage,
  type IssueReference,
  type NumberedItem,
  type RepositoryAccess,
  type RepositoryIdentity,
  type RepositorySummary,
  type SearchPage,
  type SuggestionPage,
} from "../github/port.ts";

/**
 * A synthetic issue as a test declares it. Its node ID is `I_` and its
 * `owner/name#number`, e.g. `I_acme/api#3`, by the name its repository was
 * added under: it keeps it through renames, as GitHub's node IDs do.
 */
export interface FakeIssue {
  metadata?: Partial<IssueMetadata>;
  number: number;
  title: string;
  /** Open unless said otherwise. */
  state?: "open" | "closed";
  /** Its author's login, or none for a deleted account. */
  author?: string;
  /**
   * When it was opened, as an ISO 8601 timestamp; the same for every issue
   * unless said otherwise.
   */
  createdAt?: string;
  /**
   * When a closed issue was closed, as an ISO 8601 timestamp; the same for
   * every closed issue unless said otherwise.
   */
  closedAt?: string;
  labels?: Label[];
  /**
   * Its sub-issues in GitHub's order, as `owner/name#number` of issues
   * declared in any repository, by the name it was added under. Parent
   * issues and sub-issue progress follow.
   */
  subIssues?: string[];
  /** Blocking relationships, as owner/name#number; the reverse side is derived. */
  blockers?: string[];
  blockedBy?: RelationshipCount;
  blocking?: RelationshipCount;
  /**
   * Its comments, oldest first. The first is `IC_owner/name#number/1`, and
   * each is at `…/issues/number#issuecomment-1` and so on.
   */
  comments?: FakeComment[];
}

/** How GitHub shows a synthetic repository, as a test declares it. */
export interface FakeRepositoryOptions {
  /**
   * Whether GitHub suggests it to the account: one it owns, collaborates on
   * or reaches as an organization member. Suggestions list repositories in
   * the order they were added.
   */
  suggested?: boolean;
  /** Whether an organization owns it, rather than a user. */
  organization?: boolean;
  /** Whether its Issues are turned on; they are unless said otherwise. */
  hasIssuesEnabled?: boolean;
  isArchived?: boolean;
  /**
   * Whether GitHub shows the repository but refuses the account its issues,
   * as it does a token without Issues access.
   */
  issuesDenied?: boolean;
}

/** What GitHub's issue search answers to one search text, as a test declares it. */
export type FakeSearch =
  | {
      matches: string[];
      total?: number;
      incomplete?: boolean;
      pullRequests?: number;
    }
  | { rejected: string; unsearchable?: boolean };

/** A synthetic comment as a test declares it. */
export interface FakeComment {
  /** Its author's login, or none for a deleted account. */
  author?: string;
  bodyHTML: string;
  /** An ISO 8601 timestamp; the same for every comment unless said otherwise. */
  createdAt?: string;
}

/**
 * An in-memory GitHub behind the GitHub-access port, for tests, together with
 * gh's credentials for it. Reads are what the core asks GitHub about issues
 * and repositories; checks of gh's credentials, as `gh auth status` makes
 * them, count apart. Each read that reaches GitHub costs a point of its
 * rate-limit pool's budget, 5,000 an hour unless a test sets it, and answers
 * with what is left; once a pool's budget is used up, its reads fail with
 * GitHub's primary rate limit until the pool resets.
 */
export interface FakeGitHub extends GitHubAccess {
  /**
   * gh signs in as this account from now on, with its stored credentials or
   * a token from an environment variable: GitHub answers reads that arrive
   * from now on as it, naming it.
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
  addRepository(
    nameWithOwner: string,
    issues: FakeIssue[],
    options?: FakeRepositoryOptions,
  ): void;
  /**
   * Renames or transfers a repository, `owner/name`: it keeps its ID and
   * issues, and GitHub follows its old address to the new one, as for a
   * redirect, until another repository is added at the old address, which
   * takes over its name, or unless `redirect` is false.
   */
  renameRepository(
    from: string,
    to: string,
    options?: { redirect?: boolean },
  ): void;
  /** The organizations GitHub lists the account as a member of, from now on. */
  setOrganizations(logins: string[]): void;
  /** A repository's numeric ID, by `owner/name`. */
  repositoryId(nameWithOwner: string): number;
  /**
   * Adds a pull request to a repository, `owner/name`, which numbers it with
   * its issues.
   */
  addPullRequest(nameWithOwner: string, number: number): void;
  /**
   * What GitHub's issue search answers to this exact search text from now
   * on: its matches in order, as `owner/name#number` of declared issues, up
   * to 100 a page, with GitHub's total (their number unless said otherwise)
   * and whether it reports the results incomplete, and how many pull
   * requests each page also matches; or its rejection (HTTP 422) with
   * GitHub's message, for a repository or user it cannot search when
   * `unsearchable`. Any other search matches nothing.
   */
  setSearch(query: string, answer: FakeSearch): void;
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
   * The reads GitHub has received so far, in order, each as its method and
   * what it asks about: `fetchOpenIssues acme/api` (or
   * `fetchClosedIssues`), `fetchIssues acme/api#2
   * other/lib#5`, `fetchIssueDetails acme/api#1`, `fetchIssueComments
   * acme/api#1 after 100`, `fetchBodyHtml acme/api#1 acme/api#1/2` (the
   * issue's body and its second comment's), `fetchRepositorySummaries
   * acme/api acme/web`, `fetchRepositoryAccess acme/api` or
   * `fetchRepositorySuggestions after 100` (the first page's without a
   * cursor), `fetchRepositoryById 1000001`, or `searchIssues page 1 is:open
   * label:bug`.
   */
  readonly received: readonly string[];
  /**
   * Sets what is left of a pool's budget from now on, of how many points,
   * until when GitHub resets it, in milliseconds since the epoch.
   */
  setBudget(
    pool: RateLimitPool,
    budget: { remaining: number; limit?: number; resetAt?: number },
  ): void;
  /**
   * How many requests so far asked about a repository, `owner/name`: for its
   * open issues, or for issues including one of its own.
   */
  requestsFor(nameWithOwner: string): number;
}

/** When every issue was updated, unless a test says otherwise. */
const defaultCreatedAt = "2026-09-01T12:00:00Z";

/** When every closed issue was closed, unless a test says otherwise. */
const defaultClosedAt = "2026-09-15T12:00:00Z";

/** The most comments GitHub returns in one page. */
const commentsPerPage = 100;

/** How many points a pool holds, unless a test says otherwise. */
const defaultLimit = 5000;

/** How long after it is first drawn on GitHub resets a pool. */
const budgetWindow = 60 * 60 * 1000;

export function createFakeGitHub({
  login,
  issuesPerPage = 100,
  suggestionsPerPage = 100,
  now = Date.now,
}: {
  login: string;
  /** Page size for issue lists; GitHub's largest is 100. */
  issuesPerPage?: number;
  /** Page size for repository suggestions; GitHub's largest is 100. */
  suggestionsPerPage?: number;
  /** GitHub's time, which resets its rate-limit pools. */
  now?: () => number;
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
  const received: string[] = [];
  /** Each pool's budget, once drawn on or set. */
  const budgets = new Map<RateLimitPool, Omit<RateLimitBudget, "pool">>();
  /** Each repository's pull requests' numbers, by `owner/name`. */
  const pullRequests = new Map<string, Set<number>>();
  /** Each repository's numeric ID, by `owner/name`. */
  const repositoryIds = new Map<string, number>();
  /** The ID the next repository added gets. */
  let nextRepositoryId = 1000001;
  const repositoryRequests = new Map<string, number>();
  /** How GitHub shows each repository, by `owner/name`. */
  const repositoryOptions = new Map<string, FakeRepositoryOptions>();
  /** The addresses GitHub follows to where a repository is now. */
  const redirects = new Map<string, string>();
  /** The name each renamed repository was added under, by its name now. */
  const addedAs = new Map<string, string>();
  let organizations: string[] = [];
  /** What the issue search answers, by search text. */
  const searches = new Map<string, FakeSearch>();

  /**
   * Where a repository is now, following renames and transfers, as GitHub
   * spells it: GitHub ignores case in owner and name.
   */
  function resolve(nameWithOwner: string): string {
    const seen = new Set<string>();
    let current = spelled(nameWithOwner);
    while (!repositories.has(current) && redirects.has(current)) {
      if (seen.has(current)) break;
      seen.add(current);
      current = spelled(redirects.get(current) ?? current);
    }
    return current;
  }

  /** An address as a repository or redirect GitHub knows spells it. */
  function spelled(nameWithOwner: string): string {
    const key = nameWithOwner.toLowerCase();
    return (
      [...repositories.keys(), ...redirects.keys()].find(
        (known) => known.toLowerCase() === key,
      ) ?? nameWithOwner
    );
  }

  /**
   * A repository as the picker checks it, or why GitHub will not show it to
   * the account.
   */
  function accessOf(asked: string): GitHubResult<RepositoryAccess> {
    const nameWithOwner = resolve(asked);
    const message = `Could not resolve to a Repository with the name '${asked}'.`;
    const hides = unavailable(nameWithOwner, message);
    if (hides) return { ok: false, error: hides };
    const id = repositoryIds.get(nameWithOwner);
    if (!repositories.has(nameWithOwner) || id === undefined) {
      return {
        ok: false,
        error: { kind: "unavailable", message, access: undefined },
      };
    }
    const options = repositoryOptions.get(nameWithOwner) ?? {};
    return {
      ok: true,
      value: {
        id,
        repository: addressOf(nameWithOwner),
        ownedByOrganization: options.organization ?? false,
        hasIssuesEnabled: options.hasIssuesEnabled ?? true,
        isArchived: options.isArchived ?? false,
        issuesDenied: options.issuesDenied
          ? {
              kind: "unavailable",
              message: "Resource not accessible by personal access token",
              access: undefined,
            }
          : undefined,
      },
    };
  }

  /**
   * Receives one read by a method, about `what`, and answers it as of now,
   * delivering the answer once that method is not paused. A read that
   * reaches GitHub draws on its pool's budget, unless it is used up.
   */
  async function answer<T>(
    method: GitHubRead,
    what: string,
    respond: () => GitHubResult<T>,
  ): Promise<GitHubResponse<T>> {
    requestsReceived++;
    requestsInFlight++;
    received.push(`${method} ${what}`);
    const error = credentialsError() ?? failure ?? takeNextFailure();
    let answered: GitHubResponse<T>;
    if (error && !reachesGitHub(error)) {
      answered = {
        ok: false,
        error,
        budget: undefined,
        viewerLogin: undefined,
      };
    } else {
      const pool = readPools[method];
      const budget = budgetOf(pool);
      if (budget.remaining === 0) {
        answered = {
          ok: false,
          error: {
            kind: "rate-limited",
            limit: "primary",
            message: "API rate limit already exceeded for user ID 1234567.",
          },
          budget: { pool, ...budget },
          viewerLogin: undefined,
        };
      } else {
        if (error?.kind !== "rate-limited") budget.remaining--;
        const result: GitHubResult<T> = error
          ? { ok: false, error }
          : respond();
        answered = {
          ...result,
          budget: { pool, ...budget },
          // REST answers, such as a search's, never name the account.
          viewerLogin:
            method !== "searchIssues" && namesViewer(result)
              ? viewer
              : undefined,
        };
      }
    }
    if ((pausedMethod ?? method) === method) await paused?.promise;
    requestsInFlight--;
    return answered;
  }

  /** A pool's budget as of now, which GitHub resets once its time is up. */
  function budgetOf(pool: RateLimitPool): Omit<RateLimitBudget, "pool"> {
    let budget = budgets.get(pool);
    if (!budget || now() >= budget.resetAt) {
      const limit = budget?.limit ?? defaultLimit;
      budget = { limit, remaining: limit, resetAt: now() + budgetWindow };
      budgets.set(pool, budget);
    }
    return budget;
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

  /** The name a repository, by its name now, was added under. */
  function declared(nameWithOwner: string): string {
    return addedAs.get(nameWithOwner) ?? nameWithOwner;
  }

  /** A declared issue by `owner/name#number`, following renames. */
  function find(ref: string): FakeIssue | undefined {
    const [nameWithOwner = "", number] = ref.split("#");
    return repositories
      .get(resolve(nameWithOwner))
      ?.find((issue) => issue.number === Number(number));
  }

  /** An issue as a relationship names it, by `owner/name#number` as declared. */
  function referenceTo(ref: string): IssueReference {
    const issue = find(ref);
    if (!issue) throw new Error(`The fake GitHub has no issue ${ref}.`);
    return {
      id: `I_${ref}`,
      repository: addressOf(resolve(ref.split("#")[0] ?? "")),
      number: issue.number,
      title: issue.title,
      state: issue.state ?? "open",
    };
  }

  function relationships(ref: string, side: BlockingSide): string[] {
    if (side === "blockedBy") return find(ref)?.blockers ?? [];
    return [...repositories].flatMap(([repo, issues]) =>
      issues
        .filter((issue) => issue.blockers?.includes(ref))
        .map((issue) => `${declared(repo)}#${String(issue.number)}`),
    );
  }

  function relationshipCount(
    ref: string,
    side: BlockingSide,
  ): RelationshipCount {
    const refs = relationships(ref, side);
    return {
      total: refs.length,
      open: refs.filter((ref) => find(ref)?.state !== "closed").length,
    };
  }

  /**
   * The issue as GitHub reads it, with its relationships. Those GitHub hides
   * are left out, and the issue marked incomplete for them.
   */
  function read(asked: string, issue: FakeIssue): Issue {
    const nameWithOwner = resolve(asked);
    const ref = `${declared(nameWithOwner)}#${String(issue.number)}`;
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
        const parentRef = `${declared(repository)}#${String(candidate.number)}`;
        if (candidate.subIssues?.includes(ref) && shown(parentRef)) {
          parent = referenceTo(parentRef);
        }
      }
    }
    const blockedBy = issue.blockedBy ?? relationshipCount(ref, "blockedBy");
    const blocking = issue.blocking ?? relationshipCount(ref, "blocking");
    return {
      id: `I_${ref}`,
      repository: addressOf(nameWithOwner),
      number: issue.number,
      title: issue.title,
      state: issue.state ?? "open",
      url: `https://github.com/${nameWithOwner}/issues/${String(issue.number)}`,
      author: actorOf(issue.author),
      createdAt: issue.createdAt ?? defaultCreatedAt,
      closedAt:
        issue.state === "closed"
          ? (issue.closedAt ?? defaultClosedAt)
          : undefined,
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

  /** One page of a repository's open or closed issues. */
  function issuePage(
    method: "fetchOpenIssues" | "fetchClosedIssues",
    state: "open" | "closed",
    { owner, name }: RepositoryAddress,
    after: string | undefined,
  ): Promise<GitHubResponse<IssuePage>> {
    const asked = `${owner}/${name}`;
    countRequestFor(asked);
    return answer(method, asked, () => {
      // GitHub follows renames and transfers here too.
      const nameWithOwner = resolve(asked);
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
      const inState = issues.filter(
        (issue) => (issue.state ?? "open") === state,
      );
      // The cursor is simply where the next page starts.
      const start = after === undefined ? 0 : Number(after);
      const end = start + issuesPerPage;
      // Issues GitHub hides are left out of the page, which says so.
      let incomplete: GitHubError | undefined;
      const shown = inState.slice(start, end).filter((issue) => {
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
          closedIssueCount: issues.filter((issue) => issue.state === "closed")
            .length,
          nextPage: end < inState.length ? String(end) : undefined,
          incomplete,
        },
      };
    });
  }

  /**
   * The HTML of a body by node ID: an issue's, `I_owner/name#number`, or a
   * comment's, `IC_owner/name#number/n`.
   */
  function bodyHtml(id: string): GitHubResult<string> {
    const comment = /^IC_(.+)\/(\d+)$/.exec(id);
    const ref = comment?.[1] ?? id.replace(/^I_/, "");
    const message = `Could not resolve to a node with the global id of '${id}'.`;
    const hides = unavailable(ref, message);
    if (hides) return { ok: false, error: hides };
    const issue = find(ref);
    const bodyHTML = comment
      ? issue?.comments?.[Number(comment[2]) - 1]?.bodyHTML
      : issue && (issue.metadata?.bodyHTML ?? "");
    if (bodyHTML === undefined) {
      return {
        ok: false,
        error: { kind: "unavailable", message, access: undefined },
      };
    }
    return { ok: true, value: bodyHTML };
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
    addRepository(nameWithOwner, issues, options = {}) {
      repositories.set(nameWithOwner, issues);
      repositoryOptions.set(nameWithOwner, options);
      redirects.delete(nameWithOwner);
      addedAs.delete(nameWithOwner);
      if (!repositoryIds.has(nameWithOwner)) {
        repositoryIds.set(nameWithOwner, nextRepositoryId++);
      }
    },
    renameRepository(from, to, { redirect = true } = {}) {
      const issues = repositories.get(from);
      const id = repositoryIds.get(from);
      if (!issues || id === undefined) {
        throw new Error(`The fake GitHub has no repository ${from}.`);
      }
      // A map keeps its order when an entry's value changes, not its key.
      const renamed = new Map(
        [...repositories].map(([key, value]) => [
          key === from ? to : key,
          value,
        ]),
      );
      repositories.clear();
      for (const [key, value] of renamed) repositories.set(key, value);
      repositoryIds.delete(from);
      repositoryIds.set(to, id);
      repositoryOptions.set(to, repositoryOptions.get(from) ?? {});
      repositoryOptions.delete(from);
      if (redirect) redirects.set(from, to);
      addedAs.set(to, declared(from));
      addedAs.delete(from);
    },
    setOrganizations(logins) {
      organizations = [...logins];
    },
    repositoryId(nameWithOwner) {
      const id = repositoryIds.get(nameWithOwner);
      if (id === undefined) {
        throw new Error(`The fake GitHub has no repository ${nameWithOwner}.`);
      }
      return id;
    },
    addPullRequest(nameWithOwner, number) {
      const numbers = pullRequests.get(nameWithOwner) ?? new Set();
      pullRequests.set(nameWithOwner, numbers.add(number));
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
    get received() {
      return received;
    },
    setBudget(pool, { remaining, limit = defaultLimit, resetAt }) {
      budgets.set(pool, {
        limit,
        remaining,
        resetAt: resetAt ?? now() + budgetWindow,
      });
    },
    requestsFor(nameWithOwner) {
      return repositoryRequests.get(nameWithOwner) ?? 0;
    },
    fetchIssueDetails(id) {
      const ref = id.replace(/^I_/, "");
      return answer("fetchIssueDetails", ref, () => {
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
            assignees: [],
            milestone: undefined,
            commentCount: 0,
            bodyHTML: "",
            ...issue.metadata,
          },
        };
      });
    },
    fetchRelationships(id, side, after, first = 100) {
      const ref = id.replace(/^I_/, "");
      return answer(
        "fetchRelationships",
        `${ref} ${side}${after ? ` after ${after}` : ""}`,
        () => {
          const error = unavailable(ref, "Issue unavailable");
          if (error) return { ok: false, error };
          const all = relationships(ref, side);
          const start = after === undefined ? 0 : Number(after);
          const end = start + Math.min(issuesPerPage, first);
          let incomplete: GitHubError | undefined;
          const issues = all.slice(start, end).flatMap((related) => {
            const error = unavailable(related, "Related issue unavailable");
            if (error) {
              incomplete = error;
              return [];
            }
            const issue = find(related);
            return issue ? [read(related.split("#")[0] ?? "", issue)] : [];
          });
          return {
            ok: true,
            value: {
              issues,
              incomplete,
              nextPage: end < all.length ? String(end) : undefined,
            },
          };
        },
      );
    },
    fetchIssueComments(id, after) {
      const ref = id.replace(/^I_/, "");
      const what = after === undefined ? ref : `${ref} after ${after}`;
      return answer(
        "fetchIssueComments",
        what,
        (): GitHubResult<CommentPage> => {
          const issue = find(ref);
          const message = `Could not resolve to a node with the global id of '${id}'.`;
          const hides = unavailable(ref, message);
          if (hides) return { ok: false, error: hides };
          if (!issue) {
            return {
              ok: false,
              error: { kind: "unavailable", message, access: undefined },
            };
          }
          const all = issue.comments ?? [];
          // The cursor is simply where the next page starts.
          const start = after === undefined ? 0 : Number(after);
          const end = start + commentsPerPage;
          const [nameWithOwner = ""] = ref.split("#");
          return {
            ok: true,
            value: {
              comments: all.slice(start, end).map((comment, index) => {
                const n = String(start + index + 1);
                return {
                  id: `IC_${ref}/${n}`,
                  author: actorOf(comment.author),
                  createdAt: comment.createdAt ?? defaultCreatedAt,
                  url: `https://github.com/${nameWithOwner}/issues/${String(issue.number)}#issuecomment-${n}`,
                  bodyHTML: comment.bodyHTML,
                };
              }),
              nextPage: end < all.length ? String(end) : undefined,
            },
          };
        },
      );
    },
    fetchBodyHtml(ids) {
      return answer(
        "fetchBodyHtml",
        ids.map((id) => id.replace(/^IC?_/, "")).join(" "),
        () => {
          if (ids.length > 100) {
            return {
              ok: false,
              error: {
                kind: "graphql",
                messages: ["You may not request more than 100 nodes at once."],
              },
            };
          }
          return { ok: true, value: ids.map(bodyHtml) };
        },
      );
    },
    fetchIssueByNumber({ owner, name }, number) {
      const nameWithOwner = `${owner}/${name}`;
      const ref = `${nameWithOwner}#${String(number)}`;
      return answer(
        "fetchIssueByNumber",
        ref,
        (): GitHubResult<NumberedItem> => {
          const message = `Could not resolve to an issue or pull request with the number of ${String(number)}.`;
          const hides = unavailable(ref, message);
          if (hides) return { ok: false, error: hides };
          if (pullRequests.get(nameWithOwner)?.has(number)) {
            return {
              ok: true,
              value: {
                kind: "pull-request",
                url: `https://github.com/${ref.replace("#", "/pull/")}`,
              },
            };
          }
          if (!find(ref)) {
            return {
              ok: false,
              error: { kind: "unavailable", message, access: undefined },
            };
          }
          return {
            ok: true,
            value: {
              kind: "issue",
              issue: referenceTo(ref),
              url: `https://github.com/${ref.replace("#", "/issues/")}`,
            },
          };
        },
      );
    },
    fetchOpenIssues(repository, after) {
      return issuePage("fetchOpenIssues", "open", repository, after);
    },
    fetchClosedIssues(repository, after) {
      return issuePage("fetchClosedIssues", "closed", repository, after);
    },
    fetchIssues(ids) {
      const refs = ids.map((id) => id.replace(/^I_/, ""));
      for (const nameWithOwner of new Set(
        refs.map((ref) => ref.split("#")[0]),
      )) {
        if (nameWithOwner) countRequestFor(nameWithOwner);
      }
      return answer("fetchIssues", refs.join(" "), () => {
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
      const names = addresses.map(({ owner, name }) => `${owner}/${name}`);
      return answer("fetchRepositorySummaries", names.join(" "), () => {
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
              const nameWithOwner = resolve(`${owner}/${name}`);
              const issues = repositories.get(nameWithOwner);
              const id = repositoryIds.get(nameWithOwner);
              const message = `Could not resolve to a Repository with the name '${owner}/${name}'.`;
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
                  repository: addressOf(nameWithOwner),
                  openIssueCount: issues.filter(
                    (issue) => issue.state !== "closed",
                  ).length,
                  hasIssuesEnabled:
                    repositoryOptions.get(nameWithOwner)?.hasIssuesEnabled ??
                    true,
                  isArchived:
                    repositoryOptions.get(nameWithOwner)?.isArchived ?? false,
                },
              };
            },
          ),
        };
      });
    },
    fetchRepositoryById(id) {
      return answer(
        "fetchRepositoryById",
        String(id),
        (): GitHubResult<RepositoryIdentity> => {
          const nameWithOwner = [...repositoryIds].find(
            ([, known]) => known === id,
          )?.[0];
          const notFound: GitHubError = {
            kind: "unavailable",
            message: "Not Found",
            access: undefined,
          };
          if (nameWithOwner === undefined)
            return { ok: false, error: notFound };
          const hides = hiding(nameWithOwner);
          if (hides) {
            return {
              ok: false,
              error: hides.access
                ? {
                    ...notFound,
                    message: hides.access.message,
                    access: hides.access,
                  }
                : notFound,
            };
          }
          return {
            ok: true,
            value: { id, repository: addressOf(nameWithOwner) },
          };
        },
      );
    },
    fetchRepositoryAccess(addresses) {
      const names = addresses.map(({ owner, name }) => `${owner}/${name}`);
      return answer("fetchRepositoryAccess", names.join(" "), () => {
        if (addresses.length > 100) {
          return {
            ok: false,
            error: {
              kind: "graphql",
              messages: ["The fake GitHub reads at most 100 repositories."],
            },
          };
        }
        return { ok: true, value: names.map(accessOf) };
      });
    },
    setSearch(query, searchAnswer) {
      searches.set(query, searchAnswer);
    },
    searchIssues(query, page) {
      return answer(
        "searchIssues",
        `page ${String(page)} ${query}`,
        (): GitHubResult<SearchPage> => {
          const searched = searches.get(query) ?? { matches: [] };
          if ("rejected" in searched) {
            return {
              ok: false,
              error: {
                kind: "invalid-search",
                message: searched.rejected,
                unsearchable: searched.unsearchable ?? false,
              },
            };
          }
          const shown = searched.matches.slice(
            (page - 1) * searchPageSize,
            page * searchPageSize,
          );
          return {
            ok: true,
            value: {
              total: searched.total ?? searched.matches.length,
              incomplete: searched.incomplete ?? false,
              pullRequests: searched.pullRequests ?? 0,
              issues: shown.flatMap((ref) => {
                const issue = find(ref);
                if (!issue || hiding(ref)) return [];
                // A search answers without the issues each match relates to.
                const {
                  id,
                  repository,
                  number,
                  title,
                  state,
                  url,
                  author,
                  createdAt,
                  closedAt,
                  labels,
                  subIssuesSummary,
                  issueDependenciesSummary,
                } = read(ref.split("#")[0] ?? "", issue);
                // GitHub points to a parent issue it may not show.
                const hasParent = [...repositories.values()].some((issues) =>
                  issues.some((candidate) =>
                    candidate.subIssues?.includes(ref),
                  ),
                );
                return [
                  {
                    id,
                    repository,
                    number,
                    title,
                    state,
                    url,
                    author,
                    createdAt,
                    closedAt,
                    labels,
                    hasParent,
                    subIssuesSummary,
                    issueDependenciesSummary,
                  },
                ];
              }),
            },
          };
        },
      );
    },
    fetchRepositorySuggestions(after) {
      return answer(
        "fetchRepositorySuggestions",
        after === undefined ? "" : `after ${after}`,
        (): GitHubResult<SuggestionPage> => {
          const suggested = [...repositories.keys()].filter(
            (nameWithOwner) => repositoryOptions.get(nameWithOwner)?.suggested,
          );
          // The cursor is simply where the next page starts.
          const start = after === undefined ? 0 : Number(after);
          const end = start + suggestionsPerPage;
          const incomplete: GitHubError[] = [];
          const shown = suggested.slice(start, end).flatMap((nameWithOwner) => {
            const access = accessOf(nameWithOwner);
            if (access.ok) return [access.value];
            // GitHub leaves out what it hides, with an error about it.
            incomplete.push(access.error);
            return [];
          });
          return {
            ok: true,
            value: {
              account: viewer,
              organizations:
                after === undefined ? [...organizations] : undefined,
              repositories: shown,
              nextPage: end < suggested.length ? String(end) : undefined,
              incomplete,
            },
          };
        },
      );
    },
  };
}

/**
 * Whether a read failing with an error reached GitHub, rather than failing
 * in gh.
 */
function reachesGitHub(error: GitHubError): boolean {
  switch (error.kind) {
    case "gh-not-found":
    case "gh-unusable":
    case "gh-signed-out":
    case "gh-failed":
      return false;
    case "unavailable":
    case "rate-limited":
    case "server-error":
    case "http":
    case "invalid-search":
    case "graphql":
    case "unexpected-response":
      return true;
  }
}

/**
 * Whether GitHub's answer names the account it answered as: every GraphQL
 * answer does, also about what it will not show, unless GitHub failed it
 * with an HTTP error status.
 */
function namesViewer(result: GitHubResult<unknown>): boolean {
  if (result.ok) return true;
  switch (result.error.kind) {
    case "unavailable":
    case "graphql":
      return true;
    case "gh-not-found":
    case "gh-unusable":
    case "gh-signed-out":
    case "gh-failed":
    case "rate-limited":
    case "server-error":
    case "http":
    case "invalid-search":
    case "unexpected-response":
      return false;
  }
}

/** Splits `owner/name`, or the repository of `owner/name#number`. */
function addressOf(ref: string) {
  const [owner = "", name = ""] = ref.split("#")[0]?.split("/") ?? [];
  return { owner, name };
}

/** A GitHub account by its login, or none for a deleted account. */
function actorOf(login: string | undefined): IssueActor | undefined {
  return login === undefined
    ? undefined
    : { login, avatarUrl: `https://avatars.githubusercontent.com/${login}` };
}
