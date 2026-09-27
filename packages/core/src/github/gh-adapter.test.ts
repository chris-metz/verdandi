import { describe, expect, it } from "vitest";
import type { CommandResult, CommandRunner } from "./command-runner.ts";
import { createGhAdapter } from "./gh-adapter.ts";

/**
 * A `gh` that answers every `gh api --include` call for github.com with the
 * same result. Without `--hostname`, gh would follow an inherited `GH_HOST`.
 */
function ghAnswering(result: CommandResult): CommandRunner {
  return (command, args) => {
    const hostname = args[args.indexOf("--hostname") + 1];
    if (
      command !== "gh" ||
      args[0] !== "api" ||
      !args.includes("--include") ||
      hostname !== "github.com"
    ) {
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
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
});
