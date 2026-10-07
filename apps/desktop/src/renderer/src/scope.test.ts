import type { Scope } from "@verdandi/core/contract";
import { expect, it } from "vitest";
import { presentScope, repositoryLabel, sameScope, scopeLabel } from "./scope";

function repository(owner: string, name: string): Scope {
  return { kind: "repository", repository: { owner, name } };
}

it("matches the same repository", () => {
  expect(sameScope(repository("acme", "api"), repository("acme", "api"))).toBe(
    true,
  );
});

it("tells repositories apart by owner and by name", () => {
  expect(sameScope(repository("acme", "api"), repository("acme", "web"))).toBe(
    false,
  );
  expect(
    sameScope(repository("acme", "api"), repository("octo-org", "api")),
  ).toBe(false);
});

it("matches All only with All", () => {
  expect(sameScope({ kind: "all" }, { kind: "all" })).toBe(true);
  expect(sameScope({ kind: "all" }, repository("acme", "api"))).toBe(false);
  expect(sameScope(repository("acme", "api"), { kind: "all" })).toBe(false);
});

it("names All, and a repository by owner and name", () => {
  expect(scopeLabel({ kind: "all" })).toBe("All");
  expect(scopeLabel(repository("acme", "api"))).toBe("acme/api");
});

it("names a repository by owner and name", () => {
  expect(repositoryLabel({ owner: "acme", name: "api" })).toBe("acme/api");
});

it("presents All pinned on top, with repository chips on its rows", () => {
  expect(presentScope({ kind: "all" })).toEqual({
    label: "All",
    description: "Every tracked repository",
    entry: { section: "pinned", name: "All" },
    repositoryChips: true,
  });
});

it("presents a repository in the Repositories section, owner below name", () => {
  expect(presentScope(repository("acme", "api"))).toEqual({
    label: "acme/api",
    description: "acme/api",
    entry: { section: "repositories", name: "api", owner: "acme" },
    repositoryChips: false,
  });
});
