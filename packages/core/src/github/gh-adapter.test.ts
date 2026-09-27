import { describe, expect, it } from "vitest";
import type { CommandResult, CommandRunner } from "./command-runner.ts";
import { createGhAdapter } from "./gh-adapter.ts";

/** A GraphQL request as gh reads it from its input. */
interface GraphqlRequest {
  query: string;
  variables?: Record<string, unknown>;
}

/**
 * A `gh` that answers every `gh api --include` call for github.com with the
 * same result, and records the GraphQL requests it is given. Without
 * `--hostname`, gh would follow an inherited `GH_HOST`.
 */
function ghAnswering(
  result: CommandResult,
  requests: GraphqlRequest[] = [],
): CommandRunner {
  return (command, args, options) => {
    const hostname = args[args.indexOf("--hostname") + 1];
    if (
      command !== "gh" ||
      args[0] !== "api" ||
      !args.includes("--include") ||
      hostname !== "github.com"
    ) {
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    }
    if (options?.input) {
      requests.push(JSON.parse(options.input) as GraphqlRequest);
    }
    return Promise.resolve(result);
  };
}

/**
 * A `gh api --include` transcript as gh prints it: the status line ends in LF,
 * each header in CRLF, then a blank CRLF line and the body.
 */
function transcript(status: string, headers: string[], body: string): string {
  return `HTTP/2.0 ${status}\n${headers.map((h) => `${h}\r\n`).join("")}\r\n${body}`;
}

const graphqlHeaders = [
  "Content-Type: application/json; charset=utf-8",
  "Server: github.com",
  "X-Github-Media-Type: github.v4; format=json",
  "X-Ratelimit-Limit: 5000",
  "X-Ratelimit-Remaining: 4711",
  "X-Ratelimit-Reset: 1790510601",
  "X-Ratelimit-Resource: graphql",
  "X-Ratelimit-Used: 289",
];

/**
 * An issue node as GitHub returns it for the issue fields Verdandi reads, in
 * `acme/api` and without relationships unless given.
 */
function issueNode({
  id = "I_kwDOAbCdEs4AAAAB",
  repository = "acme/api",
  number,
  title = "An issue",
  state = "OPEN",
}: {
  id?: string;
  repository?: string;
  number: number;
  title?: string;
  state?: "OPEN" | "CLOSED";
}) {
  return {
    id,
    number,
    title,
    state,
    url: `https://github.com/${repository}/issues/${String(number)}`,
    updatedAt: "2026-09-01T12:00:00Z",
    repository: { nameWithOwner: repository },
    labels: { nodes: [] },
    parent: null,
    subIssuesSummary: { total: 0, completed: 0 },
    issueDependenciesSummary: {
      blockedBy: 0,
      blocking: 0,
      totalBlockedBy: 0,
      totalBlocking: 0,
    },
    subIssues: { nodes: [] },
  };
}

describe("gh adapter", () => {
  it("reads the viewer's login", async () => {
    const github = createGhAdapter({
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 0,
        stdout: transcript(
          "200 OK",
          graphqlHeaders,
          '{"data":{"viewer":{"login":"octo-reader"}}}',
        ),
        stderr: "",
      }),
    });

    expect(await github.fetchViewer()).toEqual({
      ok: true,
      value: { login: "octo-reader" },
    });
  });

  it("reports gh missing from PATH", async () => {
    const github = createGhAdapter({
      runCommand: ghAnswering({ kind: "not-found" }),
    });

    expect(await github.fetchViewer()).toEqual({
      ok: false,
      error: { kind: "gh-not-found" },
    });
  });

  it("reports gh failing before it reaches GitHub", async () => {
    const github = createGhAdapter({
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 4,
        stdout: "",
        stderr:
          "To get started with GitHub CLI, please run:  gh auth login\n" +
          "Alternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n",
      }),
    });

    expect(await github.fetchViewer()).toEqual({
      ok: false,
      error: {
        kind: "gh-failed",
        message:
          "To get started with GitHub CLI, please run:  gh auth login\n" +
          "Alternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.",
      },
    });
  });

  it("reports an HTTP error status from GitHub", async () => {
    const github = createGhAdapter({
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 1,
        stdout: transcript(
          "401 Unauthorized",
          [
            "Content-Type: application/json; charset=utf-8",
            "Server: github.com",
            "X-Github-Media-Type: github.v3; format=json",
          ],
          '{\r\n  "message": "Bad credentials",\r\n  "documentation_url": "https://docs.github.com/rest",\r\n  "status": "401"\r\n}',
        ),
        stderr: "gh: Bad credentials (HTTP 401)\n",
      }),
    });

    expect(await github.fetchViewer()).toEqual({
      ok: false,
      error: { kind: "http", status: 401, message: "Bad credentials" },
    });
  });

  it("reports GraphQL errors that arrive with HTTP 200", async () => {
    const message =
      "Something went wrong while executing your query. This may be the result of a timeout, or it could be a GitHub bug. Please include `0000:1111:2222:3333:44445555` when reporting this issue.";
    const github = createGhAdapter({
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 1,
        stdout: transcript(
          "200 OK",
          graphqlHeaders,
          JSON.stringify({ data: null, errors: [{ message }] }),
        ),
        stderr: `gh: ${message}\n`,
      }),
    });

    expect(await github.fetchViewer()).toEqual({
      ok: false,
      error: { kind: "graphql", messages: [message] },
    });
  });

  it("reports gh that cannot be started", async () => {
    const github = createGhAdapter({
      runCommand: ghAnswering({
        kind: "failed-to-start",
        message: "spawn gh EACCES",
      }),
    });

    expect(await github.fetchViewer()).toEqual({
      ok: false,
      error: { kind: "gh-failed", message: "spawn gh EACCES" },
    });
  });

  it("reports a response body that is not JSON", async () => {
    const github = createGhAdapter({
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 0,
        stdout: transcript(
          "200 OK",
          ["Content-Type: text/html; charset=utf-8"],
          "<!DOCTYPE html><title>Unicorn!</title>",
        ),
        stderr: "",
      }),
    });

    expect(await github.fetchViewer()).toEqual({
      ok: false,
      error: { kind: "unexpected-response" },
    });
  });

  it("reports a GraphQL response without the viewer", async () => {
    const github = createGhAdapter({
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 0,
        stdout: transcript("200 OK", graphqlHeaders, '{"data":null}'),
        stderr: "",
      }),
    });

    expect(await github.fetchViewer()).toEqual({
      ok: false,
      error: { kind: "unexpected-response" },
    });
  });

  it("reads a page of a repository's open issues", async () => {
    const requests: GraphqlRequest[] = [];
    const github = createGhAdapter({
      runCommand: ghAnswering(
        {
          kind: "exited",
          exitCode: 0,
          stdout: transcript(
            "200 OK",
            graphqlHeaders,
            JSON.stringify({
              data: {
                viewer: { login: "octo-reader" },
                repository: {
                  closedIssues: { totalCount: 42 },
                  issues: {
                    pageInfo: { hasNextPage: true, endCursor: "Y3Vyc29yOjI=" },
                    nodes: [
                      {
                        id: "I_kwDOAbCdEs4AAAAM",
                        number: 12,
                        title: "Retry failed webhooks",
                        state: "OPEN",
                        url: "https://github.com/acme/api/issues/12",
                        updatedAt: "2026-09-20T08:15:00Z",
                        repository: { nameWithOwner: "acme/api" },
                        labels: {
                          nodes: [
                            { name: "bug", color: "d73a4a" },
                            { name: "webhooks", color: "c5def5" },
                          ],
                        },
                        parent: {
                          id: "I_kwDOAxYzAb4AAAAF",
                          number: 5,
                          title: "Harden the webhook pipeline",
                          state: "OPEN",
                          repository: { nameWithOwner: "acme/infra" },
                        },
                        subIssuesSummary: { total: 2, completed: 1 },
                        issueDependenciesSummary: {
                          blockedBy: 1,
                          blocking: 0,
                          totalBlockedBy: 2,
                          totalBlocking: 1,
                        },
                        subIssues: {
                          nodes: [
                            {
                              id: "I_kwDOAbCdEs4AAAAN",
                              number: 13,
                              title: "Back off between retries",
                              state: "CLOSED",
                              repository: { nameWithOwner: "acme/api" },
                            },
                            {
                              id: "I_kwDOBcDeFg4AAAAC",
                              number: 2,
                              title: "Retry in the SDK",
                              state: "OPEN",
                              repository: { nameWithOwner: "vendor/sdk" },
                            },
                          ],
                        },
                      },
                      {
                        id: "I_kwDOAbCdEs4AAAAH",
                        number: 7,
                        title: "Crash on start",
                        state: "OPEN",
                        url: "https://github.com/acme/api/issues/7",
                        updatedAt: "2026-09-18T17:40:12Z",
                        repository: { nameWithOwner: "acme/api" },
                        labels: { nodes: [] },
                        parent: null,
                        subIssuesSummary: { total: 0, completed: 0 },
                        issueDependenciesSummary: {
                          blockedBy: 0,
                          blocking: 0,
                          totalBlockedBy: 0,
                          totalBlocking: 0,
                        },
                        subIssues: { nodes: [] },
                      },
                    ],
                  },
                },
              },
            }),
          ),
          stderr: "",
        },
        requests,
      ),
    });

    expect(
      await github.fetchOpenIssues({ owner: "acme", name: "api" }),
    ).toEqual({
      ok: true,
      value: {
        issues: [
          {
            id: "I_kwDOAbCdEs4AAAAM",
            repository: { owner: "acme", name: "api" },
            number: 12,
            title: "Retry failed webhooks",
            state: "open",
            url: "https://github.com/acme/api/issues/12",
            updatedAt: "2026-09-20T08:15:00Z",
            labels: [
              { name: "bug", color: "d73a4a" },
              { name: "webhooks", color: "c5def5" },
            ],
            parent: {
              id: "I_kwDOAxYzAb4AAAAF",
              repository: { owner: "acme", name: "infra" },
              number: 5,
              title: "Harden the webhook pipeline",
              state: "open",
            },
            subIssues: [
              {
                id: "I_kwDOAbCdEs4AAAAN",
                repository: { owner: "acme", name: "api" },
                number: 13,
                title: "Back off between retries",
                state: "closed",
              },
              {
                id: "I_kwDOBcDeFg4AAAAC",
                repository: { owner: "vendor", name: "sdk" },
                number: 2,
                title: "Retry in the SDK",
                state: "open",
              },
            ],
            subIssuesSummary: { total: 2, completed: 1 },
            issueDependenciesSummary: {
              blockedBy: 1,
              totalBlockedBy: 2,
              blocking: 0,
              totalBlocking: 1,
            },
          },
          {
            id: "I_kwDOAbCdEs4AAAAH",
            repository: { owner: "acme", name: "api" },
            number: 7,
            title: "Crash on start",
            state: "open",
            url: "https://github.com/acme/api/issues/7",
            updatedAt: "2026-09-18T17:40:12Z",
            labels: [],
            parent: undefined,
            subIssues: [],
            subIssuesSummary: { total: 0, completed: 0 },
            issueDependenciesSummary: {
              blockedBy: 0,
              totalBlockedBy: 0,
              blocking: 0,
              totalBlocking: 0,
            },
          },
        ],
        closedIssueCount: 42,
        nextPage: "Y3Vyc29yOjI=",
      },
    });
    expect(requests.map((request) => request.variables)).toEqual([
      { owner: "acme", name: "api" },
    ]);
  });

  it("reads the page after a cursor, up to the last one", async () => {
    const requests: GraphqlRequest[] = [];
    const github = createGhAdapter({
      runCommand: ghAnswering(
        {
          kind: "exited",
          exitCode: 0,
          stdout: transcript(
            "200 OK",
            graphqlHeaders,
            JSON.stringify({
              data: {
                viewer: { login: "octo-reader" },
                repository: {
                  closedIssues: { totalCount: 0 },
                  issues: {
                    pageInfo: { hasNextPage: false, endCursor: "Y3Vyc29yOjM=" },
                    nodes: [issueNode({ number: 2, title: "Empty state" })],
                  },
                },
              },
            }),
          ),
          stderr: "",
        },
        requests,
      ),
    });

    const page = await github.fetchOpenIssues(
      { owner: "acme", name: "api" },
      "Y3Vyc29yOjI=",
    );

    expect(page.ok && page.value.issues.map((issue) => issue.title)).toEqual([
      "Empty state",
    ]);
    expect(page.ok && page.value.nextPage).toBeUndefined();
    expect(requests.map((request) => request.variables)).toEqual([
      { owner: "acme", name: "api", after: "Y3Vyc29yOjI=" },
    ]);
  });

  it("reports a repository GitHub cannot resolve", async () => {
    const message =
      "Could not resolve to a Repository with the name 'acme/gone'.";
    const github = createGhAdapter({
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 1,
        stdout: transcript(
          "200 OK",
          graphqlHeaders,
          JSON.stringify({
            data: { viewer: { login: "octo-reader" }, repository: null },
            errors: [
              {
                type: "NOT_FOUND",
                path: ["repository"],
                locations: [{ line: 1, column: 83 }],
                message,
              },
            ],
          }),
        ),
        stderr: `gh: ${message}\n`,
      }),
    });

    expect(
      await github.fetchOpenIssues({ owner: "acme", name: "gone" }),
    ).toEqual({
      ok: false,
      error: { kind: "graphql", messages: [message] },
    });
  });

  it("reports an issue page it cannot read", async () => {
    const github = createGhAdapter({
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 0,
        stdout: transcript(
          "200 OK",
          graphqlHeaders,
          JSON.stringify({
            data: {
              viewer: { login: "octo-reader" },
              repository: {
                closedIssues: { totalCount: 0 },
                issues: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [{ ...issueNode({ number: 1 }), number: "1" }],
                },
              },
            },
          }),
        ),
        stderr: "",
      }),
    });

    expect(
      await github.fetchOpenIssues({ owner: "acme", name: "api" }),
    ).toEqual({
      ok: false,
      error: { kind: "unexpected-response" },
    });
  });

  it("reads issues by node ID, from any repositories", async () => {
    const requests: GraphqlRequest[] = [];
    const github = createGhAdapter({
      runCommand: ghAnswering(
        {
          kind: "exited",
          exitCode: 0,
          stdout: transcript(
            "200 OK",
            graphqlHeaders,
            JSON.stringify({
              data: {
                viewer: { login: "octo-reader" },
                nodes: [
                  issueNode({
                    id: "I_kwDOAbCdEs4AAAAN",
                    number: 13,
                    title: "Back off between retries",
                    state: "CLOSED",
                  }),
                  issueNode({
                    id: "I_kwDOBcDeFg4AAAAC",
                    repository: "vendor/sdk",
                    number: 2,
                    title: "Retry in the SDK",
                  }),
                ],
              },
            }),
          ),
          stderr: "",
        },
        requests,
      ),
    });

    const read = await github.fetchIssues([
      "I_kwDOAbCdEs4AAAAN",
      "I_kwDOBcDeFg4AAAAC",
    ]);

    expect(
      read.ok &&
        read.value.map(({ id, repository, number, title, state, url }) => ({
          id,
          repository,
          number,
          title,
          state,
          url,
        })),
    ).toEqual([
      {
        id: "I_kwDOAbCdEs4AAAAN",
        repository: { owner: "acme", name: "api" },
        number: 13,
        title: "Back off between retries",
        state: "closed",
        url: "https://github.com/acme/api/issues/13",
      },
      {
        id: "I_kwDOBcDeFg4AAAAC",
        repository: { owner: "vendor", name: "sdk" },
        number: 2,
        title: "Retry in the SDK",
        state: "open",
        url: "https://github.com/vendor/sdk/issues/2",
      },
    ]);
    expect(requests.map((request) => request.variables)).toEqual([
      { ids: ["I_kwDOAbCdEs4AAAAN", "I_kwDOBcDeFg4AAAAC"] },
    ]);
  });

  it("reports an issue ID GitHub cannot resolve", async () => {
    const message =
      "Could not resolve to a node with the global id of 'I_kwDOAbCdEs4AAAAZ'.";
    const github = createGhAdapter({
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 1,
        stdout: transcript(
          "200 OK",
          graphqlHeaders,
          JSON.stringify({
            data: {
              viewer: { login: "octo-reader" },
              nodes: [issueNode({ number: 13 }), null],
            },
            errors: [
              {
                type: "NOT_FOUND",
                path: ["nodes", 1],
                locations: [{ line: 1, column: 40 }],
                message,
              },
            ],
          }),
        ),
        stderr: `gh: ${message}\n`,
      }),
    });

    expect(
      await github.fetchIssues(["I_kwDOAbCdEs4AAAAN", "I_kwDOAbCdEs4AAAAZ"]),
    ).toEqual({ ok: false, error: { kind: "graphql", messages: [message] } });
  });

  it("reports a node it cannot read as an issue", async () => {
    const github = createGhAdapter({
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 0,
        stdout: transcript(
          "200 OK",
          graphqlHeaders,
          JSON.stringify({
            data: {
              viewer: { login: "octo-reader" },
              // A pull request's ID matches no field of `... on Issue`.
              nodes: [issueNode({ number: 13 }), {}],
            },
          }),
        ),
        stderr: "",
      }),
    });

    expect(
      await github.fetchIssues(["I_kwDOAbCdEs4AAAAN", "PR_kwDOAbCdEs5AAAAB"]),
    ).toEqual({ ok: false, error: { kind: "unexpected-response" } });
  });
});

describe("gh adapter: repository summaries", () => {
  /** A repository as GitHub returns it for the fields the sidebar reads. */
  function repositoryNode({
    databaseId,
    nameWithOwner,
    openIssues,
    hasIssuesEnabled = true,
    isArchived = false,
  }: {
    databaseId: number;
    nameWithOwner: string;
    openIssues: number;
    hasIssuesEnabled?: boolean;
    isArchived?: boolean;
  }) {
    return {
      databaseId,
      nameWithOwner,
      hasIssuesEnabled,
      isArchived,
      issues: { totalCount: openIssues },
    };
  }

  it("reads several repositories in one request", async () => {
    const requests: GraphqlRequest[] = [];
    const github = createGhAdapter({
      runCommand: ghAnswering(
        {
          kind: "exited",
          exitCode: 0,
          stdout: transcript(
            "200 OK",
            graphqlHeaders,
            JSON.stringify({
              data: {
                viewer: { login: "octo-reader" },
                r0: repositoryNode({
                  databaseId: 1234567,
                  nameWithOwner: "acme/api",
                  openIssues: 12,
                }),
                // Renamed since it was tracked; GitHub follows the rename.
                r1: repositoryNode({
                  databaseId: 7654321,
                  nameWithOwner: "newco/web",
                  openIssues: 0,
                  hasIssuesEnabled: false,
                  isArchived: true,
                }),
              },
            }),
          ),
          stderr: "",
        },
        requests,
      ),
    });

    expect(
      await github.fetchRepositorySummaries([
        { owner: "acme", name: "api" },
        { owner: "acme", name: "web" },
      ]),
    ).toEqual({
      ok: true,
      value: [
        {
          ok: true,
          value: {
            id: 1234567,
            repository: { owner: "acme", name: "api" },
            openIssueCount: 12,
            hasIssuesEnabled: true,
            isArchived: false,
          },
        },
        {
          ok: true,
          value: {
            id: 7654321,
            repository: { owner: "newco", name: "web" },
            openIssueCount: 0,
            hasIssuesEnabled: false,
            isArchived: true,
          },
        },
      ],
    });
    expect(requests.map((request) => request.variables)).toEqual([
      { owner0: "acme", name0: "api", owner1: "acme", name1: "web" },
    ]);
  });

  it("reads the others when GitHub cannot resolve one repository", async () => {
    const message =
      "Could not resolve to a Repository with the name 'acme/gone'.";
    const github = createGhAdapter({
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 1,
        stdout: transcript(
          "200 OK",
          graphqlHeaders,
          JSON.stringify({
            data: {
              viewer: { login: "octo-reader" },
              r0: repositoryNode({
                databaseId: 1234567,
                nameWithOwner: "acme/api",
                openIssues: 12,
              }),
              r1: null,
              r2: repositoryNode({
                databaseId: 2345678,
                nameWithOwner: "acme/web",
                openIssues: 3,
              }),
            },
            errors: [
              {
                type: "NOT_FOUND",
                path: ["r1"],
                locations: [{ line: 1, column: 211 }],
                message,
              },
            ],
          }),
        ),
        stderr: `gh: ${message}\n`,
      }),
    });

    const read = await github.fetchRepositorySummaries([
      { owner: "acme", name: "api" },
      { owner: "acme", name: "gone" },
      { owner: "acme", name: "web" },
    ]);

    expect(
      read.ok &&
        read.value.map((one) =>
          one.ok ? one.value.openIssueCount : one.error,
        ),
    ).toEqual([12, { kind: "graphql", messages: [message] }, 3]);
  });

  it("reports a repository it cannot read, and reads the others", async () => {
    const github = createGhAdapter({
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 0,
        stdout: transcript(
          "200 OK",
          graphqlHeaders,
          JSON.stringify({
            data: {
              viewer: { login: "octo-reader" },
              r0: {
                ...repositoryNode({
                  databaseId: 1234567,
                  nameWithOwner: "acme/api",
                  openIssues: 12,
                }),
                issues: null,
              },
              r1: repositoryNode({
                databaseId: 2345678,
                nameWithOwner: "acme/web",
                openIssues: 3,
              }),
            },
          }),
        ),
        stderr: "",
      }),
    });

    const read = await github.fetchRepositorySummaries([
      { owner: "acme", name: "api" },
      { owner: "acme", name: "web" },
    ]);

    expect(
      read.ok &&
        read.value.map((one) =>
          one.ok ? one.value.openIssueCount : one.error,
        ),
    ).toEqual([{ kind: "unexpected-response" }, 3]);
  });

  it("reports a query GitHub rejected as a whole", async () => {
    const message = "API rate limit already exceeded for user ID 1234567.";
    const github = createGhAdapter({
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 1,
        stdout: transcript(
          "200 OK",
          graphqlHeaders,
          JSON.stringify({
            data: null,
            errors: [
              { type: "RATE_LIMIT", code: "graphql_rate_limit", message },
            ],
          }),
        ),
        stderr: `gh: ${message}\n`,
      }),
    });

    expect(
      await github.fetchRepositorySummaries([
        { owner: "acme", name: "api" },
        { owner: "acme", name: "web" },
      ]),
    ).toEqual({ ok: false, error: { kind: "graphql", messages: [message] } });
  });
});

it("reads issue page metadata, including nullable authors and milestones", async () => {
  const node = {
    ...issueNode({ number: 7, state: "CLOSED" }),
    stateReason: "NOT_PLANNED",
    createdAt: "2026-08-01T12:00:00Z",
    author: null,
    assignees: {
      nodes: [
        {
          login: "octo-dev",
          avatarUrl: "https://avatars.githubusercontent.com/u/2",
        },
      ],
    },
    milestone: null,
    comments: { totalCount: 12 },
  };
  const github = createGhAdapter({
    runCommand: ghAnswering({
      kind: "exited",
      exitCode: 0,
      stderr: "",
      stdout: transcript(
        "200 OK",
        graphqlHeaders,
        JSON.stringify({ data: { viewer: { login: "octo-reader" }, node } }),
      ),
    }),
  });

  expect(await github.fetchIssueDetails(node.id)).toMatchObject({
    ok: true,
    value: {
      id: node.id,
      state: "closed",
      stateReason: "not-planned",
      createdAt: "2026-08-01T12:00:00Z",
      author: undefined,
      milestone: undefined,
      assignees: [
        {
          login: "octo-dev",
          avatarUrl: "https://avatars.githubusercontent.com/u/2",
        },
      ],
      commentCount: 12,
    },
  });
});
