import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RepositoryAddress } from "../contract.ts";
import { runCommand } from "../github/run-command.ts";
import { createCheckoutReader } from "./git-adapter.ts";
import type { CheckoutJob } from "./port.ts";

const run = promisify(execFile);

// The script needs bash and git as a Mac or Linux has them; on Windows it
// would need Git for Windows' bash.
describe.skipIf(process.platform === "win32")("the checkout reader", () => {
  let root: string;
  /** Stands in for GitHub: a bare repository per `owner/name`. */
  let github: string;
  /** The folder the checkouts are in. */
  let code: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "verdandi-checkouts-")));
    github = join(root, "github");
    code = join(root, "code");
    await mkdir(code);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  /** Runs git as a test sets things up, without the user's hooks or signing. */
  async function git(cwd: string, ...args: string[]): Promise<string> {
    const { stdout } = await run(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "init.defaultBranch=main",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        `url.file://${github}/.insteadOf=https://github.com/`,
        ...args,
      ],
      { cwd },
    );
    return stdout.trim();
  }

  /** The repository on "GitHub", with a commit on each branch given. */
  async function onGitHub(
    repository: string,
    branches: string[] = ["main"],
  ): Promise<{ push(branch: string, file?: string): Promise<void> }> {
    const bare = join(github, `${repository}.git`);
    await mkdir(bare, { recursive: true });
    await git(bare, "init", "--quiet", "--bare");
    const pusher = join(root, "pushers", repository);
    await mkdir(pusher, { recursive: true });
    await git(pusher, "clone", "--quiet", bare, ".");
    await git(pusher, "commit", "--quiet", "--allow-empty", "-m", "First");
    for (const branch of branches)
      await git(
        pusher,
        "push",
        "--quiet",
        "origin",
        `HEAD:refs/heads/${branch}`,
      );
    return {
      /** Adds a commit to a branch on "GitHub", adding a file if given. */
      async push(branch, file) {
        await git(pusher, "fetch", "--quiet", "origin", branch);
        await git(pusher, "checkout", "--quiet", "-B", branch, "FETCH_HEAD");
        if (file !== undefined) {
          await writeFile(join(pusher, file), "From GitHub");
          await git(pusher, "add", file);
        }
        await git(pusher, "commit", "--quiet", "--allow-empty", "-m", "More");
        await git(pusher, "push", "--quiet", "origin", branch);
      },
    };
  }

  /**
   * Clones a repository from "GitHub" into the code folder, with a local
   * branch tracking each branch given. Its remote names github.com.
   */
  async function clone(
    repository: string,
    folder: string,
    branches: string[] = ["main"],
  ): Promise<string> {
    const path = join(code, folder);
    await git(
      code,
      "clone",
      "--quiet",
      `https://github.com/${repository}.git`,
      folder,
    );
    // Later fetches reach "GitHub" too.
    await git(
      path,
      "config",
      `url.file://${github}/.insteadOf`,
      "https://github.com/",
    );
    for (const branch of branches.filter((branch) => branch !== "main"))
      await git(
        path,
        "branch",
        "--quiet",
        "--track",
        branch,
        `origin/${branch}`,
      );
    return path;
  }

  const acmeApi: RepositoryAddress = { owner: "acme", name: "api" };
  const reader = createCheckoutReader({
    runCommand,
    host: { platform: process.platform, env: process.env, homedir: "/nowhere" },
  });
  const check = (job: Partial<CheckoutJob> = {}) =>
    reader.read(
      { kind: "this" },
      {
        folders: [code],
        repositories: [acmeApi],
        mainBranches: ["main", "testing", "dev"],
        update: false,
        ...job,
      },
    );
  const upToDate = { status: "tracking", ahead: 0, behind: 0 };

  it("finds the checkouts of tracked repositories in its folders, and reads their main branches", async () => {
    await onGitHub("acme/api", ["main", "testing"]);
    await onGitHub("acme/other");
    await clone("acme/api", "api", ["main", "testing"]);
    await clone("acme/other", "other");
    await writeFile(join(code, "notes.txt"), "Not a repository");

    expect(await check()).toEqual({
      ok: true,
      moved: 0,
      created: 0,
      groups: [
        {
          repository: acmeApi,
          checkouts: [
            { path: join(code, "api"), branch: "main", changedFiles: 0 },
          ],
          mainBranches: [
            { name: "main", upstream: upToDate },
            { name: "testing", upstream: upToDate },
          ],
          fetch: { ok: true },
        },
      ],
    });
  });

  it("fetches first, then reads how far each main branch is ahead of and behind GitHub, and the changed files", async () => {
    const api = await onGitHub("acme/api", ["main", "testing", "dev"]);
    const path = await clone("acme/api", "api", ["main", "testing", "dev"]);
    await api.push("main");
    await api.push("main");
    await api.push("dev");
    await git(path, "checkout", "--quiet", "testing");
    await git(path, "commit", "--quiet", "--allow-empty", "-m", "Mine");
    await git(path, "checkout", "--quiet", "dev");
    await git(path, "commit", "--quiet", "--allow-empty", "-m", "Mine too");
    await writeFile(join(path, "new.txt"), "New");
    await writeFile(join(path, "other.txt"), "New too");

    expect(await check()).toMatchObject({
      ok: true,
      groups: [
        {
          checkouts: [{ path, branch: "dev", changedFiles: 2 }],
          mainBranches: [
            {
              name: "main",
              upstream: { status: "tracking", ahead: 0, behind: 2 },
            },
            {
              name: "testing",
              upstream: { status: "tracking", ahead: 1, behind: 0 },
            },
            {
              name: "dev",
              upstream: { status: "tracking", ahead: 1, behind: 1 },
            },
          ],
          fetch: { ok: true },
        },
      ],
    });
  });

  it("groups a clone with its worktrees in the folders, the clone first, and fetches it once", async () => {
    await onGitHub("acme/api", ["main", "testing"]);
    const path = await clone("acme/api", "api", ["main", "testing"]);
    await git(
      path,
      "worktree",
      "add",
      "--quiet",
      join(code, "a-feature"),
      "-b",
      "feature",
    );
    await git(
      path,
      "worktree",
      "add",
      "--quiet",
      join(code, "a-testing"),
      "testing",
    );
    await git(
      path,
      "worktree",
      "add",
      "--quiet",
      join(root, "elsewhere"),
      "-b",
      "agent",
    );
    await writeFile(join(code, "a-feature", "draft.txt"), "Draft");

    const report = await check();
    expect(report).toMatchObject({
      ok: true,
      groups: [{ fetch: { ok: true } }],
    });
    if (!report.ok) return;
    expect(report.groups).toHaveLength(1);
    const [group] = report.groups;
    expect(group?.checkouts[0]).toEqual({
      path,
      branch: "main",
      changedFiles: 0,
    });
    expect(
      group?.checkouts
        .slice(1)
        .toSorted((a, b) => a.path.localeCompare(b.path)),
    ).toEqual([
      { path: join(code, "a-feature"), branch: "feature", changedFiles: 1 },
      { path: join(code, "a-testing"), branch: "testing", changedFiles: 0 },
    ]);
    expect(group?.mainBranches).toEqual([
      { name: "main", upstream: upToDate },
      { name: "testing", upstream: upToDate },
    ]);
  });

  it("finds checkouts a few levels deep, in every folder, each once, and none where there is no folder", async () => {
    await onGitHub("acme/api");
    await onGitHub("acme/web");
    await mkdir(join(code, "clients", "acme"), { recursive: true });
    // Four levels below the code folder, but three below clients.
    const api = await clone("acme/api", join("clients", "acme", "api"));
    const web = await clone("acme/web", "web");
    const acmeWeb: RepositoryAddress = { owner: "acme", name: "web" };

    const report = await check({
      folders: [code, join(code, "clients"), web, join(root, "missing")],
      repositories: [acmeApi, acmeWeb],
    });
    expect(report).toMatchObject({
      ok: true,
      groups: [
        { repository: acmeWeb, checkouts: [{ path: web }] },
        { repository: acmeApi, checkouts: [{ path: api }] },
      ],
    });
  });

  it("tells a main branch that tracks nothing, or a deleted branch, from one that is up to date", async () => {
    await onGitHub("acme/api", ["main", "testing"]);
    const path = await clone("acme/api", "api", ["main", "testing"]);
    await git(path, "branch", "--quiet", "dev");
    await git(github, "-C", "acme/api.git", "branch", "-D", "testing");
    await git(path, "fetch", "--quiet", "--prune");

    expect(await check()).toMatchObject({
      groups: [
        {
          mainBranches: [
            { name: "main", upstream: upToDate },
            { name: "testing", upstream: { status: "gone" } },
            { name: "dev", upstream: { status: "none" } },
          ],
        },
      ],
    });
  });

  it("knows a tracked repository by any form of its URL on github.com, whatever the case", async () => {
    await onGitHub("acme/api");
    const forms = [
      "git@github.com:Acme/API.git",
      "ssh://git@github.com/acme/api",
      "ssh://git@github.com:22/acme/api.git",
      "https://octo@github.com/acme/api/",
      "git://github.com/acme/api.git",
    ];
    const others = [
      "https://gitlab.com/acme/api.git",
      "https://github.com/acme/api-docs.git",
      "https://github.com.evil.example/acme/api.git",
    ];
    const paths: string[] = [];
    for (const [index, url] of [...forms, ...others].entries()) {
      const path = await clone("acme/api", `form-${String(index)}`);
      await git(path, "remote", "set-url", "origin", url);
      // Fetching fails at once, without reaching for the network.
      await git(path, "config", "url.file:///nowhere/.insteadOf", url);
      paths.push(path);
    }

    const report = await check();
    if (!report.ok) throw new Error("Not read");
    expect(
      report.groups
        .map((group) => ({
          repository: group.repository,
          path: group.checkouts[0]?.path,
        }))
        .toSorted((a, b) => (a.path ?? "").localeCompare(b.path ?? "")),
    ).toEqual(
      paths
        .slice(0, forms.length)
        .map((path) => ({ repository: acmeApi, path })),
    );
  });

  it("reads the checkouts as they are when fetching fails, with git's message", async () => {
    await onGitHub("acme/api", ["main", "testing"]);
    const path = await clone("acme/api", "api", ["main", "testing"]);
    await rm(join(github, "acme"), { recursive: true });

    expect(await check()).toMatchObject({
      ok: true,
      groups: [
        {
          checkouts: [{ path, branch: "main" }],
          mainBranches: [
            { name: "main", upstream: upToDate },
            { name: "testing", upstream: upToDate },
          ],
          fetch: {
            ok: false,
            message: expect.stringContaining("acme/api") as unknown,
          },
        },
      ],
    });
  });

  it("finds nothing in folders without checkouts of tracked repositories", async () => {
    expect(await check()).toEqual({
      ok: true,
      moved: 0,
      created: 0,
      groups: [],
    });
  });

  describe("on a host", () => {
    it("runs the same script through ssh, which can never ask for anything", async () => {
      await onGitHub("acme/api");
      const path = await clone("acme/api", "api");
      const calls: { command: string; args: readonly string[] }[] = [];
      // Stands in for ssh: runs what the host would, here.
      const throughSsh = createCheckoutReader({
        runCommand: (command, args, options) => {
          calls.push({ command, args });
          return runCommand("bash", ["-s"], options);
        },
        host: { platform: "linux", env: {}, homedir: "/home/octo" },
      });

      const report = await throughSsh.read(
        { kind: "host", address: "nuc.example.ts.net" },
        {
          folders: [code],
          repositories: [acmeApi],
          mainBranches: ["main"],
          update: false,
          programFolders: ["/somewhere/only/here"],
        },
      );
      expect(calls).toEqual([
        {
          command: "ssh",
          args: [
            "-o",
            "BatchMode=yes",
            "-o",
            "IdentityAgent=none",
            "-o",
            "ConnectTimeout=10",
            "--",
            "nuc.example.ts.net",
            "bash",
            "-s",
          ],
        },
      ]);
      expect(report).toMatchObject({
        ok: true,
        groups: [{ repository: acmeApi, checkouts: [{ path }] }],
      });
    });

    it("says when ssh cannot log in, in ssh's words", async () => {
      const failing = createCheckoutReader({
        runCommand: () =>
          Promise.resolve({
            kind: "exited",
            exitCode: 255,
            stdout: "",
            stderr:
              "Warning: Permanently added 'nuc'.\r\nocto@nuc: Permission denied (publickey).\r\n",
          }),
        host: { platform: "darwin", env: {}, homedir: "/Users/octo" },
      });
      expect(
        await failing.read(
          { kind: "host", address: "nuc" },
          {
            folders: ["~/code"],
            repositories: [acmeApi],
            mainBranches: ["main"],
            update: false,
          },
        ),
      ).toEqual({
        ok: false,
        problem: {
          kind: "cannot-log-in",
          message: "octo@nuc: Permission denied (publickey).",
        },
      });
    });
  });

  describe("bringing the main branches up to date", () => {
    const update = (job: Partial<CheckoutJob> = {}) =>
      check({ update: true, ...job });

    it("moves each main branch that is only behind, keeping changed files, creates one only GitHub has, and leaves the others", async () => {
      const api = await onGitHub("acme/api", [
        "main",
        "master",
        "test",
        "testing",
        "dev",
      ]);
      const path = await clone("acme/api", "api", [
        "main",
        "master",
        "testing",
        "dev",
      ]);
      const elsewhere = join(root, "elsewhere");
      await git(path, "worktree", "add", "--quiet", elsewhere, "master");
      for (const branch of ["main", "master", "testing", "dev"])
        await api.push(branch);
      await git(path, "checkout", "--quiet", "dev");
      await git(path, "commit", "--quiet", "--allow-empty", "-m", "Mine");
      await git(path, "checkout", "--quiet", "main");
      await writeFile(join(path, "notes.txt"), "Mine");

      expect(
        await update({
          mainBranches: ["main", "master", "test", "testing", "dev"],
        }),
      ).toEqual({
        ok: true,
        moved: 2,
        created: 1,
        groups: [
          {
            repository: acmeApi,
            checkouts: [{ path, branch: "main", changedFiles: 1 }],
            mainBranches: [
              { name: "main", upstream: upToDate },
              {
                name: "master",
                upstream: { status: "tracking", ahead: 0, behind: 1 },
                stuck: { reason: "checked-out-elsewhere", message: elsewhere },
              },
              { name: "test", upstream: upToDate },
              { name: "testing", upstream: upToDate },
              {
                name: "dev",
                upstream: { status: "tracking", ahead: 1, behind: 1 },
              },
            ],
            fetch: { ok: true },
          },
        ],
      });
    });

    it("leaves a main branch checked out in a worktree, in the folders too, as an agent may work there, and says where", async () => {
      const api = await onGitHub("acme/api", ["main", "testing"]);
      const path = await clone("acme/api", "api", ["main", "testing"]);
      const worktree = join(code, "api-testing");
      await git(path, "worktree", "add", "--quiet", worktree, "testing");
      await api.push("testing");

      expect(await update()).toMatchObject({
        moved: 0,
        groups: [
          {
            mainBranches: [
              { name: "main", upstream: upToDate },
              {
                name: "testing",
                upstream: { status: "tracking", ahead: 0, behind: 1 },
                stuck: { reason: "checked-out-elsewhere", message: worktree },
              },
            ],
          },
        ],
      });
      expect(await git(worktree, "status", "--short", "--branch")).toBe(
        "## testing...origin/testing [behind 1]",
      );
    });

    it("leaves a checked-out main branch whose merge would overwrite a changed file, and says why", async () => {
      const api = await onGitHub("acme/api");
      const path = await clone("acme/api", "api");
      await api.push("main", "notes.txt");
      await writeFile(join(path, "notes.txt"), "Mine");

      const report = await update();
      expect(report).toMatchObject({
        moved: 0,
        groups: [
          {
            checkouts: [{ path, changedFiles: 1 }],
            mainBranches: [
              {
                name: "main",
                upstream: { status: "tracking", ahead: 0, behind: 1 },
                stuck: {
                  reason: "refused",
                  message: expect.stringContaining("notes.txt") as unknown,
                },
              },
            ],
          },
        ],
      });
    });
  });
});
