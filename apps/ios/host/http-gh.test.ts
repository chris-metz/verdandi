import { createGhAdapter } from "@verdandi/core";
import { describe, expect, it } from "vitest";
import { createHttpGh, ghPath, type GitHubHttp } from "./http-gh.ts";
import type { GitHubOutcome, GitHubRequest } from "./native.ts";

/** GitHub as the app reaches it, answering every request with `answer`. */
function githubAnswering(
  answer: (request: GitHubRequest) => GitHubOutcome,
  {
    tokenSource = "stored",
  }: { tokenSource?: "stored" | "GH_TOKEN" | null } = {},
): GitHubHttp & { requests: GitHubRequest[] } {
  const requests: GitHubRequest[] = [];
  return {
    requests,
    send(request) {
      requests.push(request);
      return Promise.resolve(answer(request));
    },
    tokenSource: () => tokenSource ?? undefined,
  };
}

function response(
  status: number,
  body: unknown,
  headers: [string, string][] = [],
): GitHubOutcome {
  return {
    kind: "response",
    status,
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

const graphqlHeaders: [string, string][] = [
  ["Content-Type", "application/json; charset=utf-8"],
  ["X-Ratelimit-Limit", "5000"],
  ["X-Ratelimit-Remaining", "4711"],
  ["X-Ratelimit-Reset", "1790510601"],
  ["X-Ratelimit-Resource", "graphql"],
];

describe("gh over HTTPS", () => {
  it("answers --version as a gh the core accepts", async () => {
    const runCommand = createHttpGh(githubAnswering(() => response(200, {})));

    const result = await runCommand(ghPath, ["--version"]);

    expect(result).toMatchObject({ kind: "exited", exitCode: 0 });
    expect(result.kind === "exited" && result.stdout).toMatch(
      /^gh version 2\.81\.0 /,
    );
  });

  it("is not found anywhere else", async () => {
    const runCommand = createHttpGh(githubAnswering(() => response(200, {})));

    expect(await runCommand("/opt/homebrew/bin/gh", ["--version"])).toEqual({
      kind: "not-found",
    });
  });

  it("is signed out without a token, and asks GitHub nothing", async () => {
    const github = githubAnswering(() => response(200, {}), {
      tokenSource: null,
    });
    const adapter = createGhAdapter({
      gh: ghPath,
      runCommand: createHttpGh(github),
    });

    expect(await adapter.fetchAuthStatus()).toEqual({
      ok: true,
      value: { state: "signed-out" },
    });
    expect(github.requests).toEqual([]);
  });

  it("is signed in as the account GitHub names for the token", async () => {
    const github = githubAnswering(() =>
      response(200, { login: "octo-reader" }),
    );
    const adapter = createGhAdapter({
      gh: ghPath,
      runCommand: createHttpGh(github),
    });

    expect(await adapter.fetchAuthStatus()).toEqual({
      ok: true,
      value: {
        state: "signed-in",
        login: "octo-reader",
        tokenSource: "stored",
      },
    });
    expect(github.requests).toEqual([
      { method: "GET", path: "user", query: [] },
    ]);
  });

  it("names GH_TOKEN as the token's source when the app was launched with it", async () => {
    const github = githubAnswering(
      () => response(200, { login: "octo-reader" }),
      {
        tokenSource: "GH_TOKEN",
      },
    );
    const adapter = createGhAdapter({
      gh: ghPath,
      runCommand: createHttpGh(github),
    });

    expect(await adapter.fetchAuthStatus()).toMatchObject({
      value: { tokenSource: "GH_TOKEN" },
    });
  });

  it("is rejected when GitHub answers HTTP 401", async () => {
    const github = githubAnswering(() =>
      response(401, { message: "Bad credentials" }),
    );
    const adapter = createGhAdapter({
      gh: ghPath,
      runCommand: createHttpGh(github),
    });

    expect(await adapter.fetchAuthStatus()).toEqual({
      ok: true,
      value: {
        state: "rejected",
        login: undefined,
        tokenSource: "stored",
        message: "HTTP 401: Bad credentials (https://api.github.com/user)",
      },
    });
  });

  it("confirms nothing when GitHub cannot be reached", async () => {
    const github = githubAnswering(() => ({
      kind: "unreachable",
      message: "The Internet connection appears to be offline.",
    }));
    const adapter = createGhAdapter({
      gh: ghPath,
      runCommand: createHttpGh(github),
    });

    expect(await adapter.fetchAuthStatus()).toEqual({
      ok: false,
      error: {
        kind: "gh-failed",
        message: "The Internet connection appears to be offline.",
      },
    });
  });

  it("sends a GraphQL query as gh would, and reads GitHub's answer with its budget", async () => {
    const github = githubAnswering(() =>
      response(
        200,
        {
          data: {
            viewer: { login: "octo-reader" },
            nodes: [],
          },
        },
        graphqlHeaders,
      ),
    );
    const adapter = createGhAdapter({
      gh: ghPath,
      runCommand: createHttpGh(github),
    });

    const graphql = await adapter.fetchIssues(["I_1"]);

    expect(graphql.viewerLogin).toBe("octo-reader");
    expect(graphql.budget).toEqual({
      pool: "graphql",
      limit: 5000,
      remaining: 4711,
      resetAt: 1790510601000,
    });
    const sent = github.requests[0];
    expect(sent).toMatchObject({ method: "POST", path: "graphql", query: [] });
    expect(JSON.parse(sent?.body ?? "")).toMatchObject({
      query: expect.stringContaining("viewer { login }") as unknown,
      variables: { ids: ["I_1"] },
    });
  });

  it("sends a REST read with its fields as query parameters, unencoded", async () => {
    const github = githubAnswering(() =>
      response(200, { id: 42, full_name: "octo/renamed" }),
    );
    const adapter = createGhAdapter({
      gh: ghPath,
      runCommand: createHttpGh(github),
    });

    expect(await adapter.fetchRepositoryById(42)).toMatchObject({
      ok: true,
      value: { id: 42, repository: { owner: "octo", name: "renamed" } },
    });
    await adapter.searchIssues('is:open label:"c++" repo:octo/one', 2);

    expect(github.requests).toEqual([
      { method: "GET", path: "repositories/42", query: [] },
      {
        method: "GET",
        path: "search/issues",
        query: [
          ["q", 'is:open label:"c++" repo:octo/one'],
          ["advanced_search", "true"],
          ["per_page", "100"],
          ["page", "2"],
        ],
      },
    ]);
  });

  it("reports what GitHub will not show, from its HTTP status", async () => {
    const github = githubAnswering(() =>
      response(404, { message: "Not Found" }),
    );
    const adapter = createGhAdapter({
      gh: ghPath,
      runCommand: createHttpGh(github),
    });

    expect(await adapter.fetchRepositoryById(42)).toMatchObject({
      ok: false,
      error: { kind: "unavailable" },
    });
  });

  it("reports GitHub's rejection of a search with its message", async () => {
    const github = githubAnswering(() =>
      response(422, {
        message: "Validation Failed",
        errors: [
          {
            message:
              "The listed users and repositories cannot be searched either because the resources do not exist or you do not have permission to view them.",
          },
        ],
      }),
    );
    const adapter = createGhAdapter({
      gh: ghPath,
      runCommand: createHttpGh(github),
    });

    expect(await adapter.searchIssues("user:nobody", 1)).toMatchObject({
      ok: false,
      error: { kind: "invalid-search", unsearchable: true },
    });
  });

  it("reads as signed out without a token, as gh does with exit code 4", async () => {
    const github = githubAnswering(() => ({ kind: "signed-out" }));
    const adapter = createGhAdapter({
      gh: ghPath,
      runCommand: createHttpGh(github),
    });

    expect(await adapter.fetchRepositoryById(42)).toMatchObject({
      ok: false,
      error: { kind: "gh-signed-out" },
    });
  });

  it("reads as unreachable when GitHub cannot be reached", async () => {
    const github = githubAnswering(() => ({
      kind: "unreachable",
      message: "The request timed out.",
    }));
    const adapter = createGhAdapter({
      gh: ghPath,
      runCommand: createHttpGh(github),
    });

    expect(await adapter.fetchIssues(["I_1"])).toMatchObject({
      ok: false,
      error: {
        kind: "gh-failed",
        message: "error connecting to api.github.com: The request timed out.",
      },
    });
  });

  it("stops waiting once the command's timeout passes", async () => {
    const runCommand = createHttpGh({
      send: () => new Promise(() => undefined),
      tokenSource: () => "stored",
    });

    expect(
      await runCommand(ghPath, ["auth", "status", "--json", "hosts"], {
        timeout: 5,
      }),
    ).toEqual({ kind: "timed-out" });
  });
});
