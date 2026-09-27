import { describe, expect, it } from "vitest";
import type { Account } from "./contract.ts";
import { createCore } from "./core.ts";
import { createFakeGitHub } from "./testing/fake-github.ts";

describe("account", () => {
  it("reports the account GitHub answers as", async () => {
    const core = createCore({
      github: createFakeGitHub({ login: "octo-reader" }),
    });

    expect(await core.getAccount()).toEqual({
      status: "known",
      account: { login: "octo-reader", host: "github.com" },
    });
  });

  it("reports that gh is missing", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.failWith({ kind: "gh-not-found" });
    const core = createCore({ github });

    expect(await core.getAccount()).toEqual({
      status: "failed",
      message: "GitHub CLI (gh) was not found on PATH.",
    });
  });

  it("reports why gh failed", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.failWith({
      kind: "gh-failed",
      message: "To get started with GitHub CLI, please run:  gh auth login",
    });
    const core = createCore({ github });

    expect(await core.getAccount()).toEqual({
      status: "failed",
      message:
        "GitHub CLI (gh) failed: To get started with GitHub CLI, please run:  gh auth login",
    });
  });

  it("pushes an account change when GitHub answers as another account", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    const core = createCore({ github });
    const changes: Account[] = [];
    core.on("accountChanged", (account) => changes.push(account));

    await core.getAccount();
    github.signInAs("octo-writer");
    await core.getAccount();

    expect(changes).toEqual([{ login: "octo-writer", host: "github.com" }]);
  });
});

describe("GitHub requests", () => {
  it("are sent at most four at a time", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    const core = createCore({ github });
    github.pause();

    const answers = Array.from({ length: 10 }, () => core.getAccount());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(github.requestsInFlight).toBe(4);

    github.resume();
    expect(await Promise.all(answers)).toHaveLength(10);
  });
});
