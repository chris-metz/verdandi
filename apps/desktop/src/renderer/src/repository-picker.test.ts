import type {
  PickerRepository,
  RepositorySuggestions,
} from "@verdandi/core/contract";
import { describe, expect, it } from "vitest";
import {
  afterAdding,
  cycleFilter,
  filtersOf,
  pickerRows,
  restrictionText,
  toggled,
  unavailableText,
  type DirectCheck,
  type PickerRow,
} from "./repository-picker";

let nextId = 1;

function repository(
  nameWithOwner: string,
  more: Partial<PickerRepository> = {},
): PickerRepository {
  const [owner = "", name = ""] = nameWithOwner.split("/");
  return {
    id: nextId++,
    repository: { owner, name },
    archived: false,
    tracked: false,
    unavailable: undefined,
    ...more,
  };
}

function suggestions(
  repositories: PickerRepository[],
  more: Partial<RepositorySuggestions> = {},
): RepositorySuggestions {
  return {
    owners: [
      { login: "octo", kind: "account" },
      { login: "acme", kind: "organization" },
    ],
    repositories,
    loading: { status: "loaded", capped: false },
    restrictions: [],
    incomplete: false,
    ...more,
  };
}

/** Rows as the picker reads them: `[x]` checked, `[-]` disabled, and notes. */
function lines(rows: PickerRow[]): string[] {
  return rows.map((row) =>
    [
      row.disabled
        ? row.checked
          ? "[x-]"
          : "[-]"
        : row.checked
          ? "[x]"
          : "[ ]",
      `${row.repository.owner}/${row.repository.name}`,
      ...(row.direct ? ["(direct)"] : []),
      ...(row.archived ? ["archived"] : []),
      ...(row.note ? [`– ${row.note.text}`] : []),
    ].join(" "),
  );
}

const api = repository("acme/api");
const web = repository("acme/web");
const dotfiles = repository("octo/dotfiles");
const tool = repository("friend/tool");
const all = suggestions([api, web, dotfiles, tool]);

function rows({
  shown = all,
  filter = { kind: "all" } as const,
  text = "",
  direct,
  selected = new Map<number, PickerRepository>(),
  errors = new Map(),
  login,
}: Partial<
  Omit<Parameters<typeof pickerRows>[0], "suggestions"> & {
    shown: RepositorySuggestions;
  }
> = {}) {
  return lines(
    pickerRows({
      suggestions: shown,
      filter,
      text,
      direct,
      selected,
      errors,
      login,
    }),
  );
}

describe("pickerRows", () => {
  it("lists every suggestion to start with", () => {
    expect(rows()).toEqual([
      "[ ] acme/api",
      "[ ] acme/web",
      "[ ] octo/dotfiles",
      "[ ] friend/tool",
    ]);
  });

  it("lists the repositories of the owner selected on the left", () => {
    expect(rows({ filter: { kind: "owner", login: "acme" } })).toEqual([
      "[ ] acme/api",
      "[ ] acme/web",
    ]);
    expect(rows({ filter: { kind: "owner", login: "Octo" } })).toEqual([
      "[ ] octo/dotfiles",
    ]);
  });

  it("filters by the text typed, ignoring case", () => {
    expect(rows({ text: "WE" })).toEqual(["[ ] acme/web"]);
    expect(rows({ text: "acme/" })).toEqual(["[ ] acme/api", "[ ] acme/web"]);
  });

  it("filters by the repository a pasted URL names", () => {
    expect(rows({ text: "https://github.com/acme/web/issues/3" })).toEqual([
      "[ ] acme/web",
    ]);
  });

  it("marks tracked repositories checked and disabled, and unavailable ones disabled with why", () => {
    const shown = suggestions([
      repository("acme/api", { tracked: true }),
      repository("acme/docs", { unavailable: { kind: "issues-disabled" } }),
      repository("acme/secret", {
        unavailable: { kind: "no-issue-access", access: undefined },
      }),
      repository("acme/legacy", { archived: true }),
    ]);

    expect(rows({ shown })).toEqual([
      "[x-] acme/api – Tracked",
      "[-] acme/docs – Issues are turned off for this repository",
      "[-] acme/secret – Its issues are not accessible with this account",
      "[ ] acme/legacy archived",
    ]);
  });

  it("checks the selected repositories, and says why one could not be added", () => {
    const selected = new Map([
      [web.id, web],
      [tool.id, tool],
    ]);
    const errors = new Map([[tool.id, { text: "Cannot reach GitHub" }]]);

    expect(rows({ selected, errors })).toEqual([
      "[ ] acme/api",
      "[x] acme/web",
      "[ ] octo/dotfiles",
      "[x] friend/tool – Cannot reach GitHub",
    ]);
  });

  it("puts an exact address that is not suggested first, while it is checked and once it is", () => {
    const checking: DirectCheck = {
      status: "checking",
      repository: { owner: "cli", name: "cli" },
    };
    const cli = repository("cli/cli");
    const found: DirectCheck = {
      status: "done",
      repository: { owner: "cli", name: "cli" },
      check: { status: "found", repository: cli },
    };

    expect(rows({ text: "cli/cli", direct: checking })).toEqual([
      "[-] cli/cli (direct) – Checking…",
    ]);
    expect(rows({ text: "cli/cli", direct: found })).toEqual([
      "[ ] cli/cli (direct)",
    ]);
    expect(
      rows({
        text: "cli/cli",
        direct: found,
        selected: new Map([[cli.id, cli]]),
      }),
    ).toEqual(["[x] cli/cli (direct)"]);
  });

  it("shows an exact address outside the owner selected on the left", () => {
    const direct: DirectCheck = {
      status: "done",
      repository: { owner: "cli", name: "cli" },
      check: { status: "found", repository: repository("cli/cli") },
    };

    expect(
      rows({
        filter: { kind: "owner", login: "acme" },
        text: "cli/cli",
        direct,
      }),
    ).toEqual(["[ ] cli/cli (direct)"]);
  });

  it("says why an exact address could not be checked", () => {
    const direct: DirectCheck = {
      status: "done",
      repository: { owner: "acme", name: "gone" },
      check: {
        status: "failed",
        problem: { kind: "unavailable", access: undefined },
      },
    };

    expect(rows({ text: "acme/gone", direct })).toEqual([
      "[-] acme/gone (direct) – Unavailable or not accessible with this account",
    ]);
  });

  it("names the account an exact address is unavailable to, when known", () => {
    const direct: DirectCheck = {
      status: "done",
      repository: { owner: "acme", name: "gone" },
      check: {
        status: "failed",
        problem: { kind: "unavailable", access: undefined },
      },
    };

    expect(rows({ text: "acme/gone", direct, login: "octo" })).toEqual([
      "[-] acme/gone (direct) – Unavailable or not accessible with this account (@octo)",
    ]);
  });

  it("keeps selected repositories that are not suggested in sight, with why they could not be added, whatever is typed", () => {
    const cli = repository("cli/cli");
    const selected = new Map([[cli.id, cli]]);
    const errors = new Map([[cli.id, { text: "Cannot reach GitHub" }]]);

    expect(
      rows({
        text: "web",
        selected,
        errors,
        filter: { kind: "owner", login: "acme" },
      }),
    ).toEqual(["[x] cli/cli (direct) – Cannot reach GitHub", "[ ] acme/web"]);
  });

  it("shows a suggested exact address only as its suggestion", () => {
    const direct: DirectCheck = {
      status: "done",
      repository: { owner: "acme", name: "api" },
      check: { status: "found", repository: api },
    };

    expect(rows({ text: "Acme/API", direct })).toEqual(["[ ] acme/api"]);
  });

  it("shows a renamed exact address once, under its suggestion", () => {
    const direct: DirectCheck = {
      status: "done",
      repository: { owner: "acme", name: "old-web" },
      check: { status: "found", repository: web },
    };

    expect(rows({ text: "acme/old-web", direct })).toEqual(["[ ] acme/web"]);
  });

  it("ignores a check of another address than the one typed", () => {
    const direct: DirectCheck = {
      status: "checking",
      repository: { owner: "cli", name: "cli" },
    };

    expect(rows({ text: "cli/cl", direct })).toEqual([]);
  });
});

describe("filters", () => {
  it("start with every suggestion, then the account and organizations", () => {
    expect(filtersOf(all)).toEqual([
      { kind: "all" },
      { kind: "owner", login: "octo" },
      { kind: "owner", login: "acme" },
    ]);
  });

  it("cycle forwards and backwards, wrapping around", () => {
    const filters = filtersOf(all);
    expect(cycleFilter(filters, { kind: "all" }, 1)).toEqual({
      kind: "owner",
      login: "octo",
    });
    expect(cycleFilter(filters, { kind: "owner", login: "acme" }, 1)).toEqual({
      kind: "all",
    });
    expect(cycleFilter(filters, { kind: "all" }, -1)).toEqual({
      kind: "owner",
      login: "acme",
    });
  });

  it("cycle from a filter no longer offered back to the start", () => {
    expect(
      cycleFilter(filtersOf(all), { kind: "owner", login: "gone" }, 1),
    ).toEqual({ kind: "all" });
  });
});

describe("toggled", () => {
  it("checks and unchecks a row that can be selected", () => {
    const [row] = pickerRows({
      suggestions: all,
      filter: { kind: "all" },
      text: "",
      direct: undefined,
      selected: new Map(),
      errors: new Map(),
    });
    if (!row) throw new Error("no row");
    const checked = toggled(new Map(), row);
    expect([...checked.keys()]).toEqual([api.id]);
    expect(toggled(checked, { ...row, checked: true }).size).toBe(0);
  });

  it("leaves a disabled row as it is", () => {
    const shown = suggestions([repository("acme/api", { tracked: true })]);
    const [row] = pickerRows({
      suggestions: shown,
      filter: { kind: "all" },
      text: "",
      direct: undefined,
      selected: new Map(),
      errors: new Map(),
    });
    if (!row) throw new Error("no row");
    expect(toggled(new Map(), row).size).toBe(0);
  });
});

describe("texts", () => {
  it("explains why a repository cannot be added", () => {
    expect(unavailableText({ kind: "issues-disabled" })).toEqual({
      text: "Issues are turned off for this repository",
    });
    expect(
      unavailableText({
        kind: "no-issue-access",
        access: {
          kind: "sso",
          message: "Resource protected by organization SAML enforcement.",
          url: "https://github.com/orgs/acme/sso",
        },
      }),
    ).toEqual({
      text: "Its issues are not accessible with this account",
      detail: "Resource protected by organization SAML enforcement.",
      link: {
        label: "Authorize on GitHub",
        url: "https://github.com/orgs/acme/sso",
      },
    });
  });

  it("explains known restrictions on the suggestions", () => {
    expect(
      restrictionText({
        kind: "sso",
        message: "Resource protected by organization SAML enforcement.",
        url: undefined,
      }),
    ).toEqual({
      text: "An organization's repositories are left out until gh's token is authorized for its SAML single sign-on.",
      detail: "Resource protected by organization SAML enforcement.",
    });
    expect(
      restrictionText({
        kind: "organization-approval",
        message: "OAuth App access restrictions",
      }),
    ).toEqual({
      text: "An organization restricts OAuth App access and has not approved gh, so its repositories are left out.",
      detail: "OAuth App access restrictions",
    });
  });
});

describe("afterAdding", () => {
  it("drops the repositories added from the selection, and keeps each other one with why", () => {
    const cli = repository("cli/cli");
    const docs = repository("acme/docs");
    const chosen = [api, cli, docs];
    const after = afterAdding(
      chosen,
      [
        {
          asked: api.repository,
          status: "added",
          repository: { ...api, tracked: true },
        },
        {
          asked: cli.repository,
          status: "failed",
          problem: { kind: "unavailable", access: undefined },
        },
        {
          asked: docs.repository,
          status: "unavailable",
          repository: { ...docs, unavailable: { kind: "issues-disabled" } },
        },
      ],
      {
        selected: new Map(chosen.map((one) => [one.id, one])),
        errors: new Map([[api.id, { text: "Cannot reach GitHub" }]]),
      },
      "octo",
    );

    expect([...after.selected.keys()]).toEqual([cli.id, docs.id]);
    expect([...after.errors.entries()]).toEqual([
      [
        cli.id,
        {
          text: "Unavailable or not accessible with this account (@octo)",
          detail: undefined,
          link: undefined,
        },
      ],
      [docs.id, { text: "Issues are turned off for this repository" }],
    ]);
    expect([...after.added.values()]).toEqual([{ ...api, tracked: true }]);
  });
});
