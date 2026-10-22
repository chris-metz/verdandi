import type {
  CheckoutRow,
  Checkouts,
  Machine,
  MachineProblem,
  MainBranch,
  UpdateSummary,
} from "@verdandi/core/contract";
import { useEffect, useState } from "react";
import type { Freshness } from "./freshness";
import { timeOf, updatedAgo } from "./freshness";
import type { CheckoutsOn } from "./sidebar-entries";

/**
 * Checkouts as the core last read or pushed it; none until it has said,
 * so that a tab on Checkouts is not taken for one on something gone.
 */
export function useCheckouts(): Checkouts | undefined {
  const [checkouts, setCheckouts] = useState<Checkouts>();
  useEffect(() => {
    let current = true;
    // A push is newer than the answer to a read that started before it.
    let pushed = false;
    const unsubscribe = window.verdandi.on("checkoutsChanged", (changed) => {
      pushed = true;
      setCheckouts(changed);
    });
    window.verdandi.getCheckouts().then(
      (read) => {
        if (current && !pushed) setCheckouts(read);
      },
      () => {
        if (current && !pushed) setCheckouts({ status: "unavailable" });
      },
    );
    return () => {
      current = false;
      unsubscribe();
    };
  }, []);
  return checkouts;
}

/** What tells machines apart: `this`, or a host's ID. */
export function machineKey(machine: Machine): string {
  return machine.kind === "host" ? `host:${machine.host.id}` : "this";
}

/** What Checkouts calls a machine: this one by its kind, a host by its name. */
export function machineName(machine: Machine): string {
  if (machine.kind === "host") return machine.host.name;
  switch (window.desktop.platform) {
    case "darwin":
      return "This Mac";
    case "win32":
      return "This PC";
    default:
      return "This computer";
  }
}

/**
 * Why a machine's checkouts could not be read, in words, with a hint where
 * one helps.
 */
export function machineProblemText(problem: MachineProblem): {
  text: string;
  hint: string | undefined;
} {
  switch (problem.kind) {
    case "cannot-log-in":
      return {
        text: `Cannot log in: ${problem.message}`,
        hint: "Verdandi logs in without asking for anything, so the host must let you in without a key, as Tailscale SSH does through the host’s Tailscale name, e.g. nuc.example.ts.net.",
      };
    case "cannot-run":
      return { text: problem.message, hint: undefined };
    case "failed":
      return { text: `Could not read: ${problem.message}`, hint: undefined };
  }
}

/** Each machine that could not be read last time, named, with why. */
export function machineFailures(checkouts: CheckoutsOn): string[] {
  return checkouts.machines.flatMap((machine) =>
    machine.loading.status === "failed" || machine.loading.status === "stale"
      ? [
          `${machineName(machine)}: ${machineProblemText(machine.loading.problem).text}`,
        ]
      : [],
  );
}

/**
 * How current Checkouts is, for its header: reading while a machine is
 * read for the first time, else the age of the oldest machine's checkouts,
 * and which machines could not be read again.
 */
export function checkoutsFreshness(
  checkouts: CheckoutsOn,
  now: number,
): Freshness {
  const loadings = checkouts.machines.map(({ loading }) => loading);
  const busy =
    checkouts.updating ||
    loadings.some(
      ({ status }) => status === "loading" || status === "refreshing",
    );
  if (loadings.some(({ status }) => status === "loading"))
    return { text: "Reading checkouts…", busy, retry: false };
  const read = loadings.flatMap((loading) =>
    "updatedAt" in loading ? [loading.updatedAt] : [],
  );
  const failures = machineFailures(checkouts);
  const text = [
    ...(read.length > 0 ? [updatedAgo(Math.min(...read), now)] : []),
    ...(failures.length > 0
      ? [
          `${String(failures.length)} ${failures.length === 1 ? "machine" : "machines"} could not be read`,
        ]
      : []),
  ].join(" · ");
  return {
    text,
    detail: failures.length > 0 ? failures.join("\n") : undefined,
    busy,
    retry: failures.length > 0,
  };
}

/** How a main branch shows: its name and where it stands, in a tone. */
export interface BranchState {
  text: string;
  tone: "current" | "behind" | "ahead" | "diverged" | "untracked";
  /** Where it stands, in words. */
  title: string;
}

export function branchState({ name, upstream }: MainBranch): BranchState {
  if (upstream.status !== "tracking")
    return {
      text: name,
      tone: "untracked",
      title:
        upstream.status === "none"
          ? `${name} tracks no branch on GitHub`
          : `The branch ${name} tracks was deleted on GitHub`,
    };
  const { ahead, behind } = upstream;
  const commits = (count: number) =>
    `${String(count)} ${count === 1 ? "commit" : "commits"}`;
  if (ahead === 0 && behind === 0)
    return {
      text: `${name} ✓`,
      tone: "current",
      title: `${name} is up to date with GitHub`,
    };
  if (ahead === 0)
    return {
      text: `${name} ↓${String(behind)}`,
      tone: "behind",
      title: `${commits(behind)} on GitHub that ${name} does not have yet`,
    };
  if (behind === 0)
    return {
      text: `${name} ↑${String(ahead)}`,
      tone: "ahead",
      title: `${commits(ahead)} on ${name} that are not on GitHub`,
    };
  return {
    text: `${name} ↑${String(ahead)} ↓${String(behind)}`,
    tone: "diverged",
    title: `${name} and GitHub went apart: ${commits(ahead)} only here, ${commits(behind)} only on GitHub`,
  };
}

/**
 * Whether a tracked repository needs something somewhere: a main branch
 * behind or ahead of GitHub, one Update all left behind, or a fetch that
 * failed.
 */
export function needsAttention(row: CheckoutRow): boolean {
  return row.cells.some(
    (cell) =>
      cell.status === "found" &&
      cell.groups.some(
        (group) =>
          !group.fetch.ok ||
          group.mainBranches.some(
            ({ upstream, stuck }) =>
              stuck !== undefined ||
              (upstream.status === "tracking" &&
                (upstream.ahead > 0 || upstream.behind > 0)),
          ),
      ),
  );
}

/** What the last Update all did, in a sentence or two. */
export function updateSummaryText(summary: UpdateSummary, now: number): string {
  const { moved, created, stuck, failedMachines } = summary;
  const branches = (count: number) =>
    `${String(count)} ${count === 1 ? "branch" : "branches"}`;
  const did = [
    ...(moved > 0 ? [`moved ${branches(moved)} forward`] : []),
    ...(created > 0 ? [`created ${branches(created)} from GitHub’s`] : []),
  ];
  const sentences = [
    did.length > 0
      ? `Update all ${did.join(" and ")} at ${timeOf(summary.at, now)}.`
      : `Update all found nothing to move at ${timeOf(summary.at, now)}.`,
    ...(stuck > 0
      ? [
          `${branches(stuck)} behind GitHub stayed as ${stuck === 1 ? "it was" : "they were"}, marked below.`,
        ]
      : []),
    ...(failedMachines > 0
      ? [
          `${String(failedMachines)} ${failedMachines === 1 ? "machine" : "machines"} could not be reached.`,
        ]
      : []),
  ];
  return sentences.join(" ");
}
