import type { Scope } from "@verdandi/core/contract";
import { expect, it } from "vitest";
import { repositoryLabel, sameScope } from "./scope";

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

it("names a repository by owner and name", () => {
  expect(repositoryLabel({ owner: "acme", name: "api" })).toBe("acme/api");
});
