import type {
  AccessEvidence,
  PickerRepository,
  RepositoryAddition,
  RepositoryAddress,
  RepositoryCheck,
  RepositorySuggestions,
  RepositoryUnavailable,
} from "@verdandi/core/contract";
import {
  nameWithOwner,
  parseRepositoryInput,
  sameRepository,
} from "@verdandi/core/repository-address";
import { problemText } from "./problem-text";

/**
 * What the picker's left pane selects: every suggestion, or those of the
 * account or one of its organizations.
 */
export type PickerFilter = { kind: "all" } | { kind: "owner"; login: string };

/** A repository checked by the exact address the input names. */
export type DirectCheck =
  | { status: "checking"; repository: RepositoryAddress }
  | { status: "done"; repository: RepositoryAddress; check: RepositoryCheck };

/** What a row says besides the repository's name, e.g. why it is disabled. */
export interface RowNote {
  text: string;
  /** More, in GitHub's own words, e.g. for a tooltip. */
  detail?: string | undefined;
  /** Where to act on it, only when GitHub gave the link. */
  link?: { label: string; url: string } | undefined;
}

/** A row of the picker's right pane. */
export interface PickerRow {
  /** Tells rows apart, e.g. as React's key. */
  key: string;
  /** The repository as the row names it. */
  repository: RepositoryAddress;
  /** What adding the row adds, once it was found. */
  candidate: PickerRepository | undefined;
  checked: boolean;
  /** Whether it cannot be toggled: tracked, unavailable, or being checked. */
  disabled: boolean;
  archived: boolean;
  /** Whether it is the exact address typed, rather than a suggestion. */
  direct: boolean;
  note: RowNote | undefined;
  /** Whether the note says what went wrong, rather than what it is. */
  failed: boolean;
}

/** The left pane's filters: every suggestion, then each owner in order. */
export function filtersOf(suggestions: RepositorySuggestions): PickerFilter[] {
  return [
    { kind: "all" },
    ...suggestions.owners.map(({ login }) => ({
      kind: "owner" as const,
      login,
    })),
  ];
}

/** The filter `step` places after (or, negative, before) the current one. */
export function cycleFilter(
  filters: readonly PickerFilter[],
  current: PickerFilter,
  step: 1 | -1,
): PickerFilter {
  const index = filters.findIndex((filter) => sameFilter(filter, current));
  if (index < 0) return filters[0] ?? { kind: "all" };
  const next = (index + step + filters.length) % filters.length;
  return filters[next] ?? { kind: "all" };
}

/** Whether two filters select the same, whatever the owner's case. */
export function sameFilter(a: PickerFilter, b: PickerFilter): boolean {
  if (a.kind === "all" || b.kind === "all") return a.kind === b.kind;
  return a.login.toLowerCase() === b.login.toLowerCase();
}

/**
 * The right pane's rows: the exact address typed first, while it is not
 * suggested, whichever owner is selected; then repositories selected that
 * are not suggested, such as addresses typed before, so that each stays in
 * sight with why it could not be added; then the selected owner's
 * suggestions whose `owner/name` contains the text, or the repository a
 * pasted URL names.
 */
export function pickerRows({
  suggestions,
  filter,
  text,
  direct,
  selected,
  errors,
  login,
}: {
  suggestions: RepositorySuggestions;
  filter: PickerFilter;
  text: string;
  direct: DirectCheck | undefined;
  /** The repositories checked to be added, by ID. */
  selected: ReadonlyMap<number, PickerRepository>;
  /** Why a repository could not be added, by ID. */
  errors: ReadonlyMap<number, RowNote>;
  /** The account GitHub is read as, if known, to name it when unavailable. */
  login?: string | undefined;
}): PickerRow[] {
  const typed = parseRepositoryInput(text);
  const needle = (typed ? nameWithOwner(typed) : text.trim()).toLowerCase();
  const suggestedIds = new Set(suggestions.repositories.map(({ id }) => id));
  const rows: PickerRow[] = [];
  const shown = new Set<number>();
  function add(repository: PickerRepository, fromInput: boolean) {
    if (shown.has(repository.id)) return;
    shown.add(repository.id);
    rows.push({ ...row(repository, selected, errors), direct: fromInput });
  }

  const check =
    typed && direct && sameRepository(direct.repository, typed)
      ? direct
      : undefined;
  const found =
    check?.status === "done" && check.check.status === "found"
      ? check.check.repository
      : undefined;
  const typedIsSuggested =
    typed !== undefined &&
    suggestions.repositories.some(({ repository }) =>
      sameRepository(repository, typed),
    );
  if (check && !typedIsSuggested) {
    if (found) {
      // An old address of a suggested repository shows the suggestion.
      const suggestion = suggestions.repositories.find(
        ({ id }) => id === found.id,
      );
      add(suggestion ?? found, suggestion === undefined);
    } else {
      rows.push({
        key: `direct:${needle}`,
        repository: check.repository,
        candidate: undefined,
        checked: false,
        disabled: true,
        archived: false,
        direct: true,
        note:
          check.status === "checking"
            ? { text: "Checking…" }
            : check.check.status === "failed"
              ? problemText(check.check.problem, login)
              : undefined,
        failed: check.status === "done",
      });
    }
  }
  for (const repository of selected.values()) {
    if (!suggestedIds.has(repository.id)) add(repository, true);
  }
  for (const repository of suggestions.repositories) {
    if (
      filter.kind === "owner" &&
      !sameFilter(filter, { kind: "owner", login: repository.repository.owner })
    )
      continue;
    if (!nameWithOwner(repository.repository).toLowerCase().includes(needle))
      continue;
    add(repository, false);
  }
  return rows;
}

/** A found repository's row, as far as it can be selected. */
function row(
  repository: PickerRepository,
  selected: ReadonlyMap<number, PickerRepository>,
  errors: ReadonlyMap<number, RowNote>,
): PickerRow {
  const base = {
    key: String(repository.id),
    repository: repository.repository,
    candidate: repository,
    archived: repository.archived,
    direct: false,
  };
  if (repository.tracked) {
    return {
      ...base,
      checked: true,
      disabled: true,
      note: { text: "Tracked" },
      failed: false,
    };
  }
  if (repository.unavailable) {
    return {
      ...base,
      checked: false,
      disabled: true,
      note: unavailableText(repository.unavailable),
      failed: false,
    };
  }
  const error = errors.get(repository.id);
  return {
    ...base,
    checked: selected.has(repository.id),
    disabled: false,
    note: error,
    failed: error !== undefined,
  };
}

/** What the picker holds after adding some of its repositories. */
export interface AfterAdding {
  /** Those that could not be added, still selected. */
  selected: Map<number, PickerRepository>;
  /** Why each of those could not be added, by ID. */
  errors: Map<number, RowNote>;
  /** Those added, tracked now, by ID. */
  added: Map<number, PickerRepository>;
}

/**
 * Takes what became of adding the chosen repositories, in order: those
 * added leave the selection; the rest stay selected, each with why.
 */
export function afterAdding(
  chosen: readonly PickerRepository[],
  additions: readonly RepositoryAddition[],
  { selected, errors }: Pick<AfterAdding, "selected" | "errors">,
  login: string | undefined,
): AfterAdding {
  const next: AfterAdding = {
    selected: new Map(selected),
    errors: new Map(errors),
    added: new Map(),
  };
  chosen.forEach((repository, index) => {
    const addition = additions[index];
    const { id } = repository;
    if (addition?.status === "added") {
      next.selected.delete(id);
      next.errors.delete(id);
      next.added.set(id, addition.repository);
      return;
    }
    next.selected.set(id, repository);
    next.errors.set(
      id,
      addition === undefined
        ? { text: "It could not be added." }
        : addition.status === "failed"
          ? problemText(addition.problem, login)
          : addition.repository.unavailable
            ? unavailableText(addition.repository.unavailable)
            : { text: "It could not be added." },
    );
  });
  return next;
}

/** The selection with a row checked, or unchecked, unless it is disabled. */
export function toggled(
  selected: ReadonlyMap<number, PickerRepository>,
  row: PickerRow,
): Map<number, PickerRepository> {
  const next = new Map(selected);
  if (row.disabled || !row.candidate) return next;
  if (row.checked) next.delete(row.candidate.id);
  else next.set(row.candidate.id, row.candidate);
  return next;
}

/** Why a repository cannot be added. */
export function unavailableText(unavailable: RepositoryUnavailable): RowNote {
  switch (unavailable.kind) {
    case "issues-disabled":
      return { text: "Issues are turned off for this repository" };
    case "no-issue-access": {
      const { access } = unavailable;
      return {
        text: "Its issues are not accessible with this account",
        detail: access?.message,
        link:
          access?.kind === "sso" && access.url !== undefined
            ? { label: "Authorize on GitHub", url: access.url }
            : undefined,
      };
    }
  }
}

/** What a known restriction on the suggestions means. */
export function restrictionText(evidence: AccessEvidence): RowNote {
  switch (evidence.kind) {
    case "sso":
      return {
        text: "An organization's repositories are left out until gh's token is authorized for its SAML single sign-on.",
        detail: evidence.message,
        link:
          evidence.url === undefined
            ? undefined
            : { label: "Authorize on GitHub", url: evidence.url },
      };
    case "organization-approval":
      return {
        text: "An organization restricts OAuth App access and has not approved gh, so its repositories are left out.",
        detail: evidence.message,
      };
  }
}
