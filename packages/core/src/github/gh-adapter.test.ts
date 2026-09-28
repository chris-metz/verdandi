import { describe, expect, it } from "vitest";
import type { CommandResult, CommandRunner } from "./command-runner.ts";
import { createGhAdapter } from "./gh-adapter.ts";

/** A GraphQL request as gh reads it from its input. */
interface GraphqlRequest {
  query: string;
  variables?: Record<string, unknown>;
}

/** Where the adapter is told gh is. */
const ghPath = "/opt/homebrew/bin/gh";

/**
 * A `gh` at `ghPath` that answers every `gh api --include` call for
 * github.com with the same result, and records the GraphQL requests it is
 * given. Without `--hostname`, gh would follow an inherited `GH_HOST`.
 */
function ghAnswering(
  result: CommandResult,
  requests: GraphqlRequest[] = [],
): CommandRunner {
  return (command, args, options) => {
    const hostname = args[args.indexOf("--hostname") + 1];
    if (
      command !== ghPath ||
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

/** The budget `graphqlHeaders` report: 4,711 of 5,000 left until 12:03:21. */
const graphqlBudget = {
  pool: "graphql",
  limit: 5000,
  remaining: 4711,
  resetAt: Date.parse("2026-09-27T12:03:21Z"),
};

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
  it("reports gh missing", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnswering({ kind: "not-found" }),
    });

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      ok: false,
      error: { kind: "gh-not-found" },
    });
  });

  it("reports gh without credentials for github.com, which exits with code 4 before asking GitHub", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 4,
        stdout: "",
        stderr:
          "To get started with GitHub CLI, please run:  gh auth login\n" +
          "Alternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n",
      }),
    });

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      ok: false,
      error: {
        kind: "gh-signed-out",
        message:
          "To get started with GitHub CLI, please run:  gh auth login\n" +
          "Alternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.",
      },
    });
  });

  it("reports gh failing before it reaches GitHub, e.g. without a connection", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 1,
        stdout: "",
        stderr:
          'Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host\n',
      }),
    });

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      ok: false,
      error: {
        kind: "gh-failed",
        message:
          'Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host',
      },
    });
  });

  it("reports an HTTP error status from GitHub", async () => {
    const github = createGhAdapter({
      gh: ghPath,
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

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      ok: false,
      error: { kind: "http", status: 401, message: "Bad credentials" },
    });
  });

  it("reports GraphQL errors that arrive with HTTP 200", async () => {
    const message = "Field 'bodyText' doesn't exist on type 'Issue'";
    const github = createGhAdapter({
      gh: ghPath,
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

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      budget: graphqlBudget,
      ok: false,
      error: { kind: "graphql", messages: [message] },
    });
  });

  it("reports gh that cannot be started", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnswering({
        kind: "failed-to-start",
        message: "spawn /opt/homebrew/bin/gh EACCES",
      }),
    });

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      ok: false,
      error: {
        kind: "gh-unusable",
        message: "spawn /opt/homebrew/bin/gh EACCES",
      },
    });
  });

  it("reports any other HTTP error status by its status", async () => {
    const message = "Validation Failed";
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringHttp("422 Unprocessable Entity", message),
    });

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      ok: false,
      error: { kind: "http", status: 422, message },
    });
  });
});

/**
 * A `gh` whose every `gh api --include` call gets an HTTP error status from
 * GitHub, with a REST error body carrying `message`, and extra headers.
 */
function ghAnsweringHttp(
  status: string,
  message: string,
  headers: string[] = [],
): CommandRunner {
  return ghAnswering({
    kind: "exited",
    exitCode: 1,
    stdout: transcript(
      status,
      ["Content-Type: application/json; charset=utf-8", ...headers],
      JSON.stringify({
        message,
        documentation_url: "https://docs.github.com/rest",
      }),
    ),
    stderr: `gh: ${message} (HTTP ${status.slice(0, 3)})\n`,
  });
}

/**
 * A `gh` whose every GraphQL query gets HTTP 200 with `data` and `errors`,
 * and extra headers.
 */
function ghAnsweringGraphql(
  data: unknown,
  errors: unknown[],
  headers: string[] = [],
): CommandRunner {
  return ghAnswering({
    kind: "exited",
    exitCode: errors.length > 0 ? 1 : 0,
    stdout: transcript(
      "200 OK",
      [...graphqlHeaders, ...headers],
      JSON.stringify(errors.length > 0 ? { data, errors } : { data }),
    ),
    stderr: errors
      .map((error) => `gh: ${(error as { message: string }).message}\n`)
      .join(""),
  });
}

const samlMessage =
  "Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.";

const oauthRestrictionMessage =
  "Although you appear to have the correct authorization credentials, the `acme` organization has enabled OAuth App access restrictions, meaning that data access to third-parties is limited. For more information on these restrictions, including how to enable this app, visit https://docs.github.com/articles/restricting-access-to-your-organization-s-data/";

describe("gh adapter: what GitHub will not show", () => {
  it.each([
    ["404 Not Found", "Not Found"],
    ["403 Forbidden", "Resource not accessible by integration"],
    ["410 Gone", "Issues are disabled for this repo"],
  ])(
    "reports HTTP %s as unavailable, without guessing why",
    async (status, message) => {
      const github = createGhAdapter({
        gh: ghPath,
        runCommand: ghAnsweringHttp(status, message),
      });

      expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
        ok: false,
        error: { kind: "unavailable", message, access: undefined },
      });
    },
  );

  it("names SSO, with GitHub's link to authorize, when GitHub says SAML SSO is required", async () => {
    const url =
      "https://github.com/orgs/acme/sso?authorization_request=A1B2C3D4E5";
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringHttp("403 Forbidden", samlMessage, [
        `X-Github-Sso: required; url=${url}`,
      ]),
    });

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      ok: false,
      error: {
        kind: "unavailable",
        message: samlMessage,
        access: { kind: "sso", message: samlMessage, url },
      },
    });
  });

  it("names SSO without a link when GitHub's answer gives none", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringGraphql(
        { viewer: { login: "octo-reader" }, repository: null },
        [
          {
            type: "FORBIDDEN",
            path: ["repository"],
            extensions: { saml_failure: true },
            locations: [{ line: 1, column: 40 }],
            message: samlMessage,
          },
        ],
      ),
    });

    expect(
      await github.fetchOpenIssues({ owner: "acme", name: "api" }),
    ).toEqual({
      budget: graphqlBudget,
      viewerLogin: "octo-reader",
      ok: false,
      error: {
        kind: "unavailable",
        message: samlMessage,
        access: { kind: "sso", message: samlMessage, url: undefined },
      },
    });
  });

  it("names an organization's OAuth App access restrictions when GitHub says so", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringGraphql(
        { viewer: { login: "octo-reader" }, repository: null },
        [
          {
            type: "FORBIDDEN",
            path: ["repository"],
            locations: [{ line: 1, column: 40 }],
            message: oauthRestrictionMessage,
          },
        ],
      ),
    });

    expect(
      await github.fetchOpenIssues({ owner: "acme", name: "api" }),
    ).toEqual({
      budget: graphqlBudget,
      viewerLogin: "octo-reader",
      ok: false,
      error: {
        kind: "unavailable",
        message: oauthRestrictionMessage,
        access: {
          kind: "organization-approval",
          message: oauthRestrictionMessage,
        },
      },
    });
  });

  it("reports a repository GitHub cannot resolve as unavailable", async () => {
    const message =
      "Could not resolve to a Repository with the name 'acme/gone'.";
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringGraphql(
        { viewer: { login: "octo-reader" }, repository: null },
        [
          {
            type: "NOT_FOUND",
            path: ["repository"],
            locations: [{ line: 1, column: 83 }],
            message,
          },
        ],
      ),
    });

    expect(
      await github.fetchOpenIssues({ owner: "acme", name: "gone" }),
    ).toEqual({
      budget: graphqlBudget,
      viewerLogin: "octo-reader",
      ok: false,
      error: { kind: "unavailable", message, access: undefined },
    });
  });

  it("reports an issue whose page it cannot read as unavailable", async () => {
    const message =
      "Could not resolve to a node with the global id of 'I_kwDOAbCdEs4AAAAZ'.";
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringGraphql(
        { viewer: { login: "octo-reader" }, node: null },
        [{ type: "NOT_FOUND", path: ["node"], message }],
      ),
    });

    expect(await github.fetchIssueDetails("I_kwDOAbCdEs4AAAAZ")).toEqual({
      budget: graphqlBudget,
      viewerLogin: "octo-reader",
      ok: false,
      error: { kind: "unavailable", message, access: undefined },
    });
  });
});

describe("gh adapter: failures worth trying again", () => {
  it.each([
    ["500 Internal Server Error", "Server Error"],
    ["502 Bad Gateway", "We couldn't respond to your request in time."],
    ["503 Service Unavailable", "Service Unavailable"],
  ])("reports HTTP %s as a server error", async (status, message) => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringHttp(status, message),
    });

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      ok: false,
      error: { kind: "server-error", message },
    });
  });

  it("reports a GraphQL query that timed out as a server error", async () => {
    const message =
      "Something went wrong while executing your query. This may be the result of a timeout, or it could be a GitHub bug. Please include `0000:1111:2222:3333:44445555` when reporting this issue.";
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringGraphql(null, [{ message }]),
    });

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      budget: graphqlBudget,
      ok: false,
      error: { kind: "server-error", message },
    });
  });
});

describe("gh adapter: rate limits", () => {
  /** The headers of a GraphQL pool GitHub says is used up until 12:03:21. */
  const exhaustedHeaders = [
    "X-Ratelimit-Limit: 5000",
    "X-Ratelimit-Remaining: 0",
    "X-Ratelimit-Reset: 1790510601",
    "X-Ratelimit-Resource: graphql",
    "X-Ratelimit-Used: 5000",
  ];

  it("reads the budget left in GraphQL's pool from rateLimit, asked with every query", async () => {
    const requests: GraphqlRequest[] = [];
    const github = createGhAdapter({
      gh: ghPath,
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
                rateLimit: {
                  limit: 5000,
                  remaining: 4708,
                  resetAt: "2026-09-27T12:03:21Z",
                },
                nodes: [issueNode({ number: 1 })],
              },
            }),
          ),
          stderr: "",
        },
        requests,
      ),
    });

    const read = await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"]);

    expect(read.budget).toEqual({
      pool: "graphql",
      limit: 5000,
      remaining: 4708,
      resetAt: Date.parse("2026-09-27T12:03:21Z"),
    });
    expect(requests[0]?.query).toMatch(
      /\brateLimit \{ limit remaining resetAt \}/,
    );
  });

  it("reads the budget from the x-ratelimit headers when GitHub answers without rateLimit", async () => {
    const message = "Field 'bodyText' doesn't exist on type 'Issue'";
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringGraphql(null, [{ message }]),
    });

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      ok: false,
      error: { kind: "graphql", messages: [message] },
      budget: graphqlBudget,
    });
  });

  it("reports no budget when GitHub's answer does not say", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringHttp("502 Bad Gateway", "Server Error"),
    });

    const read = await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"]);

    expect(read.ok).toBe(false);
    expect(read.budget).toBeUndefined();
  });

  it("reports an exhausted pool with when it resets, never as unavailable", async () => {
    const message =
      "API rate limit exceeded for user ID 1234567. If you reach out to GitHub Support for help, please include the request ID 0000:1111:2222:3333:44445555 and timestamp 2026-09-28 06:20:48 UTC.";
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringHttp("403 Forbidden", message, exhaustedHeaders),
    });

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      ok: false,
      error: { kind: "rate-limited", limit: "primary", message },
      budget: { ...graphqlBudget, remaining: 0 },
    });
  });

  it("reports an exhausted GraphQL pool that arrives with HTTP 200", async () => {
    const message = "API rate limit exceeded for user ID 1234567.";
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 1,
        stdout: transcript(
          "200 OK",
          [
            "Content-Type: application/json; charset=utf-8",
            ...exhaustedHeaders,
          ],
          JSON.stringify({ errors: [{ type: "RATE_LIMITED", message }] }),
        ),
        stderr: `gh: ${message}\n`,
      }),
    });

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      ok: false,
      error: { kind: "rate-limited", limit: "primary", message },
      budget: { ...graphqlBudget, remaining: 0 },
    });
  });

  it("reports GraphQL's rate limit at HTTP 200 as the used-up pool, also when a query costs more than is left", async () => {
    const message =
      "API rate limit exceeded for user ID 1234567. The query cost 3, but only 2 points remain.";
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 1,
        stdout: transcript(
          "200 OK",
          [
            "Content-Type: application/json; charset=utf-8",
            "X-Ratelimit-Limit: 5000",
            "X-Ratelimit-Remaining: 2",
            "X-Ratelimit-Reset: 1790510601",
            "X-Ratelimit-Resource: graphql",
          ],
          JSON.stringify({ errors: [{ type: "RATE_LIMITED", message }] }),
        ),
        stderr: `gh: ${message}\n`,
      }),
    });

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      ok: false,
      error: { kind: "rate-limited", limit: "primary", message },
      budget: { ...graphqlBudget, remaining: 2 },
    });
  });

  it("reports a secondary rate limit with how long GitHub asks to wait, never as unavailable", async () => {
    const message =
      "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.";
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringHttp("403 Forbidden", message, [
        "Retry-After: 60",
        ...graphqlHeaders.slice(3),
      ]),
    });

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      ok: false,
      error: {
        kind: "rate-limited",
        limit: "secondary",
        message,
        retryAfter: 60 * 1000,
      },
      budget: graphqlBudget,
    });
  });

  it("reports a secondary rate limit when GitHub does not say how long to wait", async () => {
    const message =
      "You have exceeded a secondary rate limit. Please wait a few minutes before you try again. If you reach out to GitHub Support for help, please include the request ID 0000:1111:2222:3333:44445555.";
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringHttp("403 Forbidden", message, [
        ...graphqlHeaders.slice(3),
      ]),
    });

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      ok: false,
      error: {
        kind: "rate-limited",
        limit: "secondary",
        message,
        retryAfter: undefined,
      },
      budget: graphqlBudget,
    });
  });

  it("reports HTTP 429 with retry-after as a secondary rate limit", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringHttp(
        "429 Too Many Requests",
        "Too Many Requests",
        ["Retry-After: 120"],
      ),
    });

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      ok: false,
      error: {
        kind: "rate-limited",
        limit: "secondary",
        message: "Too Many Requests",
        retryAfter: 120 * 1000,
      },
    });
  });
});

describe("gh adapter: partial answers", () => {
  it("keeps the issues it can read when GitHub cannot resolve another", async () => {
    const message =
      "Could not resolve to a node with the global id of 'I_kwDOAbCdEs4AAAAZ'.";
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringGraphql(
        {
          viewer: { login: "octo-reader" },
          nodes: [issueNode({ id: "I_kwDOAbCdEs4AAAAN", number: 13 }), null],
        },
        [
          {
            type: "NOT_FOUND",
            path: ["nodes", 1],
            locations: [{ line: 1, column: 40 }],
            message,
          },
        ],
      ),
    });

    const read = await github.fetchIssues([
      "I_kwDOAbCdEs4AAAAN",
      "I_kwDOAbCdEs4AAAAZ",
    ]);

    expect(
      read.ok &&
        read.value.map((one) => (one.ok ? one.value.number : one.error)),
    ).toEqual([13, { kind: "unavailable", message, access: undefined }]);
  });

  it("keeps an issue whose sub-issue GitHub would not show, marking it incomplete", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringGraphql(
        {
          viewer: { login: "octo-reader" },
          nodes: [
            {
              ...issueNode({ id: "I_kwDOAbCdEs4AAAAN", number: 13 }),
              subIssuesSummary: { total: 2, completed: 0 },
              subIssues: {
                nodes: [
                  {
                    id: "I_kwDOAbCdEs4AAAAO",
                    number: 14,
                    title: "Readable",
                    state: "OPEN",
                    repository: { nameWithOwner: "acme/api" },
                  },
                  null,
                ],
              },
            },
          ],
        },
        [
          {
            type: "FORBIDDEN",
            path: ["nodes", 0, "subIssues", "nodes", 1],
            extensions: { saml_failure: true },
            message: samlMessage,
          },
        ],
      ),
    });

    const read = await github.fetchIssues(["I_kwDOAbCdEs4AAAAN"]);
    const [issue] = read.ok ? read.value : [];

    expect(
      issue?.ok && issue.value.subIssues.map(({ number }) => number),
    ).toEqual([14]);
    expect(issue?.ok && issue.value.incomplete).toEqual({
      kind: "unavailable",
      message: samlMessage,
      access: { kind: "sso", message: samlMessage, url: undefined },
    });
  });

  it("keeps the readable issues of a page, marking it incomplete", async () => {
    const message =
      "Something went wrong while executing your query. This may be the result of a timeout, or it could be a GitHub bug.";
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringGraphql(
        {
          viewer: { login: "octo-reader" },
          repository: {
            closedIssues: { totalCount: 0 },
            issues: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [issueNode({ number: 2 }), null],
            },
          },
        },
        [{ path: ["repository", "issues", "nodes", 1], message }],
      ),
    });

    const page = await github.fetchOpenIssues({ owner: "acme", name: "api" });

    expect(page.ok && page.value.issues.map(({ number }) => number)).toEqual([
      2,
    ]);
    expect(page.ok && page.value.incomplete).toEqual({
      kind: "server-error",
      message,
    });
  });
});

describe("gh adapter: more reads", () => {
  it("reports a response body that is not JSON", async () => {
    const github = createGhAdapter({
      gh: ghPath,
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

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      ok: false,
      error: { kind: "unexpected-response" },
    });
  });

  it("reports a GraphQL response without the viewer", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 0,
        stdout: transcript("200 OK", graphqlHeaders, '{"data":null}'),
        stderr: "",
      }),
    });

    expect(await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"])).toEqual({
      budget: graphqlBudget,
      ok: false,
      error: { kind: "unexpected-response" },
    });
  });

  it("reads a page of a repository's open issues", async () => {
    const requests: GraphqlRequest[] = [];
    const github = createGhAdapter({
      gh: ghPath,
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
      budget: graphqlBudget,
      viewerLogin: "octo-reader",
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
      gh: ghPath,
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

  it("reports an issue page it cannot read", async () => {
    const github = createGhAdapter({
      gh: ghPath,
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
      budget: graphqlBudget,
      viewerLogin: "octo-reader",
      ok: false,
      error: { kind: "unexpected-response" },
    });
  });

  it("reads issues by node ID, from any repositories", async () => {
    const requests: GraphqlRequest[] = [];
    const github = createGhAdapter({
      gh: ghPath,
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
        read.value.map((one) => {
          if (!one.ok) return one.error;
          const { id, repository, number, title, state, url } = one.value;
          return { id, repository, number, title, state, url };
        }),
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

  it("reports a node it cannot read as an issue", async () => {
    const github = createGhAdapter({
      gh: ghPath,
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

    const read = await github.fetchIssues([
      "I_kwDOAbCdEs4AAAAN",
      "PR_kwDOAbCdEs5AAAAB",
    ]);

    expect(
      read.ok &&
        read.value.map((one) => (one.ok ? one.value.number : one.error)),
    ).toEqual([13, { kind: "unexpected-response" }]);
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
      gh: ghPath,
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
      budget: graphqlBudget,
      viewerLogin: "octo-reader",
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
      gh: ghPath,
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
    ).toEqual([12, { kind: "unavailable", message, access: undefined }, 3]);
  });

  it("reports a repository it cannot read, and reads the others", async () => {
    const github = createGhAdapter({
      gh: ghPath,
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
    const message = "Field 'openIssues' doesn't exist on type 'Repository'";
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnswering({
        kind: "exited",
        exitCode: 1,
        stdout: transcript(
          "200 OK",
          graphqlHeaders,
          JSON.stringify({
            data: null,
            errors: [{ extensions: { code: "undefinedField" }, message }],
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
    ).toEqual({
      ok: false,
      error: { kind: "graphql", messages: [message] },
      budget: graphqlBudget,
    });
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
    gh: ghPath,
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

describe("gh adapter: the account GitHub answers as", () => {
  it("names the account GitHub answered a query as", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringGraphql(
        { viewer: { login: "octo-writer" }, nodes: [issueNode({ number: 1 })] },
        [],
      ),
    });

    const read = await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"]);

    expect(read.ok).toBe(true);
    expect(read.viewerLogin).toBe("octo-writer");
  });

  it("names the account also when GitHub will not show what the query asked for", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringGraphql(
        { viewer: { login: "octo-writer" }, repository: null },
        [
          {
            type: "NOT_FOUND",
            path: ["repository"],
            locations: [{ line: 1, column: 40 }],
            message:
              "Could not resolve to a Repository with the name 'acme/api'.",
          },
        ],
      ),
    });

    const read = await github.fetchOpenIssues({ owner: "acme", name: "api" });

    expect(read.ok).toBe(false);
    expect(read.viewerLogin).toBe("octo-writer");
  });

  it("names no account when GitHub answers with an HTTP error", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAnsweringHttp("401 Unauthorized", "Bad credentials"),
    });

    const read = await github.fetchIssues(["I_kwDOAbCdEs4AAAAB"]);

    expect(read.ok).toBe(false);
    expect(read.viewerLogin).toBeUndefined();
  });
});

describe("gh adapter: auth status", () => {
  /**
   * A `gh` at `ghPath` that answers `gh auth status` for github.com's active
   * account, as JSON, with `result`.
   */
  function ghAuthStatus(result: CommandResult): CommandRunner {
    return (command, args) => {
      const expected = [
        "auth",
        "status",
        "--json",
        "hosts",
        "--hostname",
        "github.com",
        "--active",
      ];
      if (command !== ghPath || args.join(" ") !== expected.join(" ")) {
        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      }
      return Promise.resolve(result);
    };
  }

  /** gh's answer to `gh auth status --json hosts`, which always exits 0. */
  function hosts(entries: Record<string, unknown>[] | undefined) {
    return ghAuthStatus({
      kind: "exited",
      exitCode: 0,
      stdout: JSON.stringify({
        hosts: entries === undefined ? {} : { "github.com": entries },
      }),
      stderr:
        entries === undefined
          ? "You are not logged into any GitHub hosts. To log in, run: gh auth login\n"
          : "",
    });
  }

  it("reads the account gh's stored credentials sign in as", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: hosts([
        {
          state: "success",
          active: true,
          host: "github.com",
          login: "octo-reader",
          tokenSource: "keyring",
          scopes: "gist, read:org, repo, workflow",
          gitProtocol: "https",
        },
      ]),
    });

    expect(await github.fetchAuthStatus()).toEqual({
      ok: true,
      value: {
        state: "signed-in",
        login: "octo-reader",
        tokenSource: "stored",
      },
    });
  });

  it("counts a token in gh's config file as stored", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: hosts([
        {
          state: "success",
          active: true,
          host: "github.com",
          login: "octo-reader",
          tokenSource: "/home/octo/.config/gh/hosts.yml",
          gitProtocol: "https",
        },
      ]),
    });

    expect(await github.fetchAuthStatus()).toEqual({
      ok: true,
      value: {
        state: "signed-in",
        login: "octo-reader",
        tokenSource: "stored",
      },
    });
  });

  it.each(["GH_TOKEN", "GITHUB_TOKEN"] as const)(
    "names %s when its token overrides gh's stored credentials",
    async (variable) => {
      const github = createGhAdapter({
        gh: ghPath,
        runCommand: hosts([
          {
            state: "success",
            active: true,
            host: "github.com",
            login: "octo-bot",
            tokenSource: variable,
            gitProtocol: "https",
          },
        ]),
      });

      expect(await github.fetchAuthStatus()).toEqual({
        ok: true,
        value: { state: "signed-in", login: "octo-bot", tokenSource: variable },
      });
    },
  );

  it("reports gh without credentials for github.com", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: hosts(undefined),
    });

    expect(await github.fetchAuthStatus()).toEqual({
      ok: true,
      value: { state: "signed-out" },
    });
  });

  it("reports stored credentials GitHub rejected", async () => {
    const error =
      "HTTP 401: Bad credentials (https://api.github.com/)\nTry authenticating with:  gh auth login";
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: hosts([
        {
          state: "error",
          error,
          active: true,
          host: "github.com",
          login: "octo-reader",
          tokenSource: "keyring",
          gitProtocol: "https",
        },
      ]),
    });

    expect(await github.fetchAuthStatus()).toEqual({
      ok: true,
      value: {
        state: "rejected",
        login: "octo-reader",
        tokenSource: "stored",
        message: error,
      },
    });
  });

  it("reports a token in GH_TOKEN that GitHub rejected", async () => {
    const error =
      'non-200 OK status code: 401 Unauthorized body: "{\\r\\n  \\"message\\": \\"Bad credentials\\",\\r\\n  \\"documentation_url\\": \\"https://docs.github.com/rest\\",\\r\\n  \\"status\\": \\"401\\"\\r\\n}"';
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: hosts([
        {
          state: "error",
          error,
          active: true,
          host: "github.com",
          login: "",
          tokenSource: "GH_TOKEN",
          gitProtocol: "https",
        },
      ]),
    });

    expect(await github.fetchAuthStatus()).toEqual({
      ok: true,
      value: {
        state: "rejected",
        login: undefined,
        tokenSource: "GH_TOKEN",
        message: error,
      },
    });
  });

  it.each([
    [
      "error",
      'Get "https://api.github.com/": dial tcp: lookup api.github.com: no such host',
    ],
    [
      "timeout",
      'Get "https://api.github.com/": net/http: request canceled while waiting for connection (Client.Timeout exceeded while awaiting headers)',
    ],
    ["error", "HTTP 502: Server Error (https://api.github.com/)"],
  ])(
    "cannot confirm the credentials when checking them ends in %s: %s",
    async (state, error) => {
      const github = createGhAdapter({
        gh: ghPath,
        runCommand: hosts([
          {
            state,
            error,
            active: true,
            host: "github.com",
            login: "octo-reader",
            tokenSource: "keyring",
            gitProtocol: "https",
          },
        ]),
      });

      expect(await github.fetchAuthStatus()).toEqual({
        ok: false,
        error: { kind: "gh-failed", message: error },
      });
    },
  );

  it("reports gh that fails without an answer", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAuthStatus({
        kind: "exited",
        exitCode: 1,
        stdout: "",
        stderr:
          "failed to read configuration: open config.yml: permission denied\n",
      }),
    });

    expect(await github.fetchAuthStatus()).toEqual({
      ok: false,
      error: {
        kind: "gh-failed",
        message:
          "failed to read configuration: open config.yml: permission denied",
      },
    });
  });

  it("gives up on a check that does not finish, confirming nothing", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      // Only a timeout ends it.
      runCommand: (_command, _args, options) =>
        options?.timeout === undefined
          ? new Promise(() => undefined)
          : Promise.resolve({ kind: "timed-out" }),
    });

    expect(await github.fetchAuthStatus()).toEqual({
      ok: false,
      error: { kind: "gh-failed", message: "gh did not finish in time." },
    });
  });

  it("reports gh missing", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAuthStatus({ kind: "not-found" }),
    });

    expect(await github.fetchAuthStatus()).toEqual({
      ok: false,
      error: { kind: "gh-not-found" },
    });
  });

  it("reports an answer it cannot read", async () => {
    const github = createGhAdapter({
      gh: ghPath,
      runCommand: ghAuthStatus({
        kind: "exited",
        exitCode: 0,
        stdout: "github.com\n  ✓ Logged in to github.com account octo-reader\n",
        stderr: "",
      }),
    });

    expect(await github.fetchAuthStatus()).toEqual({
      ok: false,
      error: { kind: "unexpected-response" },
    });
  });
});
