import { expect, it } from "vitest";
import { describeViewScope } from "./view-scope.ts";

it("covers every readable repository when no repo:, org: or user: qualifier narrows it", () => {
  expect(describeViewScope("is:open assignee:@me")).toEqual({
    covers: { kind: "everywhere" },
    warning: undefined,
  });
  expect(describeViewScope("")).toEqual({
    covers: { kind: "everywhere" },
    warning: undefined,
  });
});

it("names the repositories and owners a search is limited to, in order and once each", () => {
  expect(
    describeViewScope(
      '(repo:acme/api OR repo:acme/web OR REPO:Acme/Api) org:acme "user:not-a-qualifier" is:open',
    ),
  ).toEqual({
    covers: {
      kind: "only",
      targets: [
        { kind: "repository", name: "acme/api" },
        { kind: "repository", name: "acme/web" },
        { kind: "owner", login: "acme" },
      ],
    },
    warning: undefined,
  });
  expect(describeViewScope("user:octo sort:updated-desc").covers).toEqual({
    kind: "only",
    targets: [{ kind: "owner", login: "octo" }],
  });
});

it("ignores excluded repositories, which do not narrow the search", () => {
  expect(describeViewScope("-repo:acme/api is:open").covers).toEqual({
    kind: "everywhere",
  });
  expect(describeViewScope("repo:acme/web -repo:acme/api").covers).toEqual({
    kind: "only",
    targets: [{ kind: "repository", name: "acme/web" }],
  });
});

it("warns about several repo: qualifiers side by side, which advanced search combines with AND", () => {
  expect(
    describeViewScope("repo:acme/api repo:acme/web is:open").warning,
  ).toEqual({
    kind: "repositories-combined",
    repositories: ["acme/api", "acme/web"],
  });
  expect(
    describeViewScope("repo:acme/api AND (repo:acme/web OR repo:acme/ops)")
      .warning,
  ).toEqual({
    kind: "repositories-combined",
    repositories: ["acme/api", "acme/web", "acme/ops"],
  });
});

it("does not warn when OR joins the repositories, or one is named twice", () => {
  for (const query of [
    "repo:acme/api OR repo:acme/web",
    "(repo:acme/api OR repo:acme/web) is:open",
    "repo:acme/api label:bug OR repo:acme/web label:bug",
    "repo:acme/api repo:ACME/api",
    "repo:acme/api (label:bug OR label:ux)",
  ]) {
    expect(describeViewScope(query).warning, query).toBeUndefined();
  }
});

it("still names the scope of a search GitHub would reject, leaving the rest to GitHub", () => {
  expect(describeViewScope("(repo:acme/api OR").covers).toEqual({
    kind: "only",
    targets: [{ kind: "repository", name: "acme/api" }],
  });
  expect(describeViewScope("repo: is:open").covers).toEqual({
    kind: "everywhere",
  });
});
