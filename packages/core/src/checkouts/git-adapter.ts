import path from "node:path";
import type {
  Checkout,
  CheckoutSwitchResult,
  MainBranch,
  MachineProblem,
  StuckBranch,
} from "../contract.ts";
import type { HostEnvironment } from "../directories.ts";
import type { CommandRunner } from "../github/command-runner.ts";
import { repositoryKey } from "../repository-address.ts";
import type {
  CheckoutReader,
  MachineAddress,
  MachineReport,
  ReportedGroup,
} from "./port.ts";
import { checkoutScript } from "./script.ts";

/**
 * Fetching a machine's checkouts and bringing them up to date stops after
 * this many milliseconds.
 */
const timeout = 5 * 60 * 1000;

/**
 * Options `ssh` gets for a host: it never asks, for a password or a key's
 * passphrase, and uses no agent, which could ask in its own window. A host
 * that lets the user in without a key, as Tailscale SSH does, still lets
 * them in.
 */
const sshOptions = [
  "-o",
  "BatchMode=yes",
  "-o",
  "IdentityAgent=none",
  "-o",
  "ConnectTimeout=10",
];

/**
 * The checkout-reading port through bash and git: on this machine, and on
 * a host through the system's `ssh`.
 */
export function createCheckoutReader({
  runCommand,
  host,
}: {
  runCommand: CommandRunner;
  host: HostEnvironment;
}): CheckoutReader {
  return {
    async read(machine, job) {
      const input = checkoutScript(
        machine.kind === "this" ? job : { ...job, programFolders: [] },
      );
      const [command, args] = commandFor(machine, host);
      const result = await runCommand(command, args, { input, timeout });
      switch (result.kind) {
        case "not-found":
          return failed(
            "cannot-run",
            machine.kind === "this"
              ? `${command} was not found, which reads the checkouts.`
              : "ssh was not found, which reaches the host.",
          );
        case "failed-to-start":
          return failed("cannot-run", result.message);
        case "timed-out":
          return failed(
            "failed",
            "Reading the checkouts took longer than five minutes, and was stopped.",
          );
        case "exited":
          break;
      }
      const message = lastLine(result.stderr);
      if (machine.kind === "host" && result.exitCode === 255)
        return failed("cannot-log-in", message ?? "ssh could not log in.");
      if (result.exitCode === 127)
        return failed("cannot-run", message ?? "bash was not found.");
      if (result.exitCode !== 0)
        return failed(
          "failed",
          message ?? `It stopped with exit code ${String(result.exitCode)}.`,
        );
      return reportOf(result.stdout, job.repositories, job.mainBranches);
    },
  };
}

/** How the script runs on a machine: bash here, or bash through ssh. */
function commandFor(
  machine: MachineAddress,
  host: HostEnvironment,
): [string, string[]] {
  if (machine.kind === "host")
    return ["ssh", [...sshOptions, "--", machine.address, "bash", "-s"]];
  // Git for Windows brings the bash that runs it there.
  const bash =
    host.platform === "win32"
      ? path.win32.join(
          host.env.ProgramFiles ?? "C:\\Program Files",
          "Git",
          "bin",
          "bash.exe",
        )
      : "bash";
  return [bash, ["-s"]];
}

function failed(kind: MachineProblem["kind"], message: string): MachineReport {
  return { ok: false, problem: { kind, message } };
}

/** The last line of a program's errors that says anything. */
function lastLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .at(-1);
}

/** What the script printed, as the checkouts of the tracked repositories. */
function reportOf(
  output: string,
  repositories: readonly { owner: string; name: string }[],
  mainBranches: readonly string[],
): MachineReport {
  const groups = new Map<string, ReportedGroup>();
  const branches = new Map<string, Map<string, MainBranch["upstream"]>>();
  const stuck = new Map<string, Map<string, StuckBranch>>();
  let moved = 0;
  let created = 0;
  let switched: CheckoutSwitchResult | undefined;
  for (const line of output.split("\n")) {
    const [kind, ...fields] = line.split("\t");
    switch (kind) {
      case "E":
        return failed("cannot-run", fields[0] ?? "Nothing could be read.");
      case "G": {
        const [group = "", name = "", fetch, message = ""] = fields;
        const repository = repositories.find(
          (one) => repositoryKey(one) === name,
        );
        if (!repository) break;
        groups.set(group, {
          repository,
          checkouts: [],
          mainBranches: [],
          fetch: fetch === "ok" ? { ok: true } : { ok: false, message },
        });
        break;
      }
      case "B": {
        const [group = "", name = "", upstream = "", track = ""] = fields;
        if (!mainBranches.includes(name)) break;
        const known =
          branches.get(group) ?? new Map<string, MainBranch["upstream"]>();
        known.set(name, upstreamOf(upstream, track));
        branches.set(group, known);
        break;
      }
      case "C": {
        const [group = "", path = "", branch = "", changed = "0", own] = fields;
        const found = groups.get(group);
        const checkout: Checkout = {
          path,
          branch: branch === "" ? undefined : branch,
          changedFiles: Number(changed) || 0,
          worktree: own !== "1",
        };
        found?.checkouts.push(checkout);
        break;
      }
      case "S": {
        const [outcome, message = ""] = fields;
        switched = outcome === "ok" ? { ok: true } : { ok: false, message };
        break;
      }
      case "U": {
        const [group = "", name = "", outcome, message = ""] = fields;
        if (outcome === "moved") moved++;
        else if (outcome === "created") created++;
        else {
          const known = stuck.get(group) ?? new Map<string, StuckBranch>();
          known.set(name, {
            reason:
              outcome === "elsewhere" ? "checked-out-elsewhere" : "refused",
            message,
          });
          stuck.set(group, known);
        }
        break;
      }
    }
  }
  return {
    ok: true,
    moved,
    created,
    ...(switched ? { switched } : {}),
    groups: [...groups].map(([key, group]) => ({
      ...group,
      // The clone's own checkout first, then its worktrees.
      checkouts: group.checkouts.toSorted(
        (a, b) => Number(a.worktree) - Number(b.worktree),
      ),
      mainBranches: mainBranches.flatMap((name) => {
        const upstream = branches.get(key)?.get(name);
        const left = stuck.get(key)?.get(name);
        return upstream
          ? [{ name, upstream, ...(left ? { stuck: left } : {}) }]
          : [];
      }),
    })),
  };
}

/**
 * How a branch stands against the one it tracks, as `for-each-ref` puts it:
 * e.g. `ahead 2, behind 1`, `gone`, or nothing when it is up to date.
 */
function upstreamOf(upstream: string, track: string): MainBranch["upstream"] {
  if (upstream === "") return { status: "none" };
  if (track === "gone") return { status: "gone" };
  const count = (word: string) =>
    Number(new RegExp(`${word} (\\d+)`).exec(track)?.[1] ?? 0);
  return { status: "tracking", ahead: count("ahead"), behind: count("behind") };
}
