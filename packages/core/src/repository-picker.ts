import { inBatches } from "./batches.ts";
import {
  suggestionLimit,
  type AccessEvidence,
  type PickerOwner,
  type PickerRepository,
  type RepositoryAddition,
  type RepositoryAddress,
  type RepositoryCheck,
  type RepositorySuggestions,
  type SuggestionsLoading,
} from "./contract.ts";
import type {
  GitHubError,
  GitHubResult,
  RepositoryAccess,
} from "./github/port.ts";
import {
  atOrAfter,
  fiveMinutesAgo,
  type Clock,
  type Moment,
} from "./moments.ts";
import { problemOf } from "./problems.ts";
import { sameRepository } from "./repository-address.ts";
import type { RequestResult, SendRequest } from "./request-queue.ts";
import type { Settings, SettingsStorage } from "./settings/port.ts";

/**
 * The repository picker's side in the core: its suggestions, checking a
 * repository by its address, and adding repositories. Suggestions are read
 * page by page while the picker is open, and kept for five minutes; what the
 * picker checks or adds is read afresh each time.
 */
export interface RepositoryPicker {
  /**
   * Pushes the suggestions as they are, reading them anew unless they are
   * being read or were read in the last five minutes.
   */
  open(): void;
  /** Checks a repository by its address, as the contract's `checkRepository`. */
  check(repository: RepositoryAddress): Promise<RepositoryCheck>;
  /**
   * Checks repositories afresh and tracks those whose issues can be read, as
   * the contract's `addRepositories`, pushing the suggestions marked anew.
   */
  add(
    repositories: readonly RepositoryAddress[],
  ): Promise<RepositoryAddition[]>;
  /** Marks the suggestions tracked anew, e.g. after the settings file changed. */
  settingsChanged(): void;
}

/** What the picker reads from and writes to, and whom it tells. */
export interface RepositoryPickerOptions {
  settings: SettingsStorage;
  request: SendRequest;
  clock: Clock;
  /** Whether the picker is open, so that its requests are needed. */
  isOpen: () => boolean;
  /** Pushes the suggestions to the interfaces. */
  push: (suggestions: RepositorySuggestions) => void;
}

/** At most this many repositories are checked in one request. */
const repositoriesPerRequest = 100;

/** What a repository missing from GitHub's answer counts as. */
const unanswered: GitHubResult<RepositoryAccess> = {
  ok: false,
  error: { kind: "unexpected-response" },
};

/** The suggestions as read so far, before they are marked tracked. */
interface Suggested {
  /** The account GitHub listed them for, once a page has arrived. */
  account: string | undefined;
  /** The organizations GitHub lists the account as a member of. */
  organizations: string[];
  repositories: RepositoryAccess[];
  /**
   * How far they have loaded; `interrupted` when the picker closed before
   * they did, so that they are read anew as it opens again.
   */
  loading: SuggestionsLoading | { status: "interrupted" };
  restrictions: AccessEvidence[];
  /** Whether GitHub reported errors about what it left out. */
  incomplete: boolean;
  /** When GitHub was asked for the first page. */
  readAt: Moment;
}

export function createRepositoryPicker({
  settings,
  request,
  clock,
  isOpen,
  push,
}: RepositoryPickerOptions): RepositoryPicker {
  let suggested: Suggested | undefined;
  /** The tracked repositories as last read from the settings file. */
  let tracked: Settings["repositories"] = [];
  /** Counts reads of the suggestions, so that only the latest one counts. */
  let reads = 0;

  async function readTracked() {
    tracked = (await settings.read()).value.repositories;
  }

  /** Whether a repository is tracked: by its ID where known, else by name. */
  function isTracked({ id, repository }: RepositoryAccess): boolean {
    return tracked.some((entry) =>
      entry.id === undefined
        ? sameRepository(entry, repository)
        : entry.id === id,
    );
  }

  function pickerRepository(access: RepositoryAccess): PickerRepository {
    return {
      id: access.id,
      repository: access.repository,
      archived: access.isArchived,
      tracked: isTracked(access),
      unavailable: !access.hasIssuesEnabled
        ? { kind: "issues-disabled" }
        : access.issuesDenied
          ? {
              kind: "no-issue-access",
              access: evidenceOf(access.issuesDenied),
            }
          : undefined,
    };
  }

  function pushSuggested() {
    if (!suggested || !isOpen()) return;
    const {
      account,
      organizations,
      repositories,
      loading,
      restrictions,
      incomplete,
    } = suggested;
    push({
      owners: owners(account, organizations, repositories),
      repositories: repositories.map(pickerRepository),
      // Interrupted only once the picker closed, when nothing is pushed.
      loading:
        loading.status === "interrupted" ? { status: "loading" } : loading,
      restrictions,
      incomplete,
    });
  }

  /** Reads the suggestions anew, page by page, pushing each. */
  async function readSuggestions() {
    const read = ++reads;
    const current: Suggested = {
      account: undefined,
      organizations: [],
      repositories: [],
      loading: { status: "loading" },
      restrictions: [],
      incomplete: false,
      readAt: clock(),
    };
    suggested = current;
    await readTracked();
    if (read !== reads) return;
    pushSuggested();
    let after: string | undefined;
    for (;;) {
      const result = await request("fetchRepositorySuggestions", [after], () =>
        isOpen() ? "visible" : undefined,
      );
      if (read !== reads) return;
      if (!result.ok) {
        current.loading =
          result.error.kind === "interrupted"
            ? { status: "interrupted" }
            : { status: "failed", problem: problemOf(result.error) };
        pushSuggested();
        return;
      }
      const page = result.value;
      current.account = page.account;
      if (page.organizations) current.organizations = page.organizations;
      current.repositories.push(...page.repositories);
      if (page.incomplete.length > 0) current.incomplete = true;
      for (const error of page.incomplete) {
        const evidence = evidenceOf(error);
        if (
          evidence &&
          !current.restrictions.some(
            (known) =>
              known.kind === evidence.kind &&
              known.message === evidence.message,
          )
        )
          current.restrictions.push(evidence);
      }
      const capped =
        current.repositories.length > suggestionLimit ||
        (current.repositories.length === suggestionLimit &&
          page.nextPage !== undefined);
      if (capped) current.repositories.length = suggestionLimit;
      if (capped || page.nextPage === undefined) {
        current.loading = { status: "loaded", capped };
        pushSuggested();
        return;
      }
      pushSuggested();
      after = page.nextPage;
    }
  }

  /** Checks repositories, 100 at a time, each on its own. */
  async function checkAll(
    repositories: readonly RepositoryAddress[],
  ): Promise<RequestResult<RepositoryAccess>[]> {
    const batches = await Promise.all(
      inBatches(repositories, repositoriesPerRequest).map(async (batch) => {
        const result = await request(
          "fetchRepositoryAccess",
          [batch],
          () => "visible",
        );
        return batch.map((_, index) =>
          result.ok ? (result.value[index] ?? unanswered) : result,
        );
      }),
    );
    await readTracked();
    return batches.flat();
  }

  return {
    open() {
      const loading = suggested?.loading.status;
      const recent =
        suggested !== undefined &&
        atOrAfter(suggested.readAt, fiveMinutesAgo(clock));
      if (loading === "loading" || (loading === "loaded" && recent)) {
        // The settings file may have changed while the picker was closed.
        void readTracked().then(pushSuggested);
        return;
      }
      void readSuggestions();
    },
    async check(repository) {
      const [result = unanswered] = await checkAll([repository]);
      if (!result.ok) {
        return { status: "failed", problem: problemOf(result.error) };
      }
      return { status: "found", repository: pickerRepository(result.value) };
    },
    async add(repositories) {
      const results = await checkAll(repositories);
      // Each repository once, however often or under whichever names asked.
      const addable = new Map<number, RepositoryAccess>();
      for (const result of results) {
        if (result.ok && readable(result.value)) {
          if (!addable.has(result.value.id)) {
            addable.set(result.value.id, result.value);
          }
        }
      }
      const written =
        addable.size === 0
          ? ({ ok: true } as const)
          : await settings.addRepositories(
              [...addable.values()].map(({ id, repository }) => ({
                ...repository,
                id,
              })),
            );
      if (addable.size > 0 && written.ok) {
        await readTracked();
        pushSuggested();
      }
      return repositories.map((asked, index): RepositoryAddition => {
        const result = results[index] ?? unanswered;
        if (!result.ok) {
          return { asked, status: "failed", problem: problemOf(result.error) };
        }
        const repository = pickerRepository(result.value);
        if (repository.unavailable) {
          return { asked, status: "unavailable", repository };
        }
        if (!written.ok) {
          return {
            asked,
            status: "failed",
            problem: { kind: "error", message: written.message },
          };
        }
        return { asked, status: "added", repository };
      });
    },
    settingsChanged() {
      if (suggested && isOpen()) void readTracked().then(pushSuggested);
    },
  };
}

/**
 * The picker's owners: the account first, then its known organizations,
 * alphabetically, each once whatever its case.
 */
function owners(
  account: string | undefined,
  organizations: readonly string[],
  repositories: readonly RepositoryAccess[],
): PickerOwner[] {
  const known = new Map<string, string>();
  for (const login of [
    ...organizations,
    ...repositories
      .filter(({ ownedByOrganization }) => ownedByOrganization)
      .map(({ repository }) => repository.owner),
  ]) {
    const key = login.toLowerCase();
    if (key !== account?.toLowerCase() && !known.has(key))
      known.set(key, login);
  }
  return [
    ...(account === undefined
      ? []
      : [{ login: account, kind: "account" as const }]),
    ...[...known.values()]
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
      .map((login) => ({ login, kind: "organization" as const })),
  ];
}

/** Whether a repository's issues can be read, so that it can be added. */
function readable(access: RepositoryAccess): boolean {
  return access.hasIssuesEnabled && access.issuesDenied === undefined;
}

/** Why GitHub refused something, when it said so. */
function evidenceOf(error: GitHubError): AccessEvidence | undefined {
  return error.kind === "unavailable" ? error.access : undefined;
}
