import type {
  Checkout,
  CheckoutCell,
  CheckoutGroup,
  Machine,
  MainBranch,
} from "@verdandi/core/contract";
import { TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  branchState,
  checkoutsFreshness,
  machineKey,
  machineName,
  machineProblemText,
  updateSummaryText,
  type BranchState,
} from "./checkouts";
import { MachineDialog, type MachineDialogPurpose } from "./MachineDialog";
import {
  PrototypeGroup,
  PrototypeSwitcher,
  prototypeNeedsAttention,
  usePrototypeCheckouts,
} from "./PROTOTYPE-checkout-switch";
import { RefreshControl } from "./RefreshControl";
import type { CheckoutsOn } from "./sidebar-entries";
import { useNow } from "./use-now";

/** The colours of a main branch's chip, by where it stands. */
const tones: Record<BranchState["tone"], string> = {
  current: "text-issue-open",
  behind: "border-selection-edge/50 text-selection-edge",
  ahead: "border-warning/50 text-warning",
  diverged: "border-warning/50 text-warning",
  untracked: "text-muted-foreground",
};

/**
 * Checkouts: the tracked repositories' checkouts, a row per repository and
 * a column per machine, those that need something first. Each cell shows
 * the main branches of the checkouts there, where they stand against
 * GitHub, and the checkouts themselves. **Update all** brings every main
 * branch up to date; hosts are added and changed here.
 */
export function CheckoutsPane({ checkouts: read }: { checkouts: CheckoutsOn }) {
  // PROTOTYPE (checkout switch): made-up checkouts instead of those read.
  void read;
  const checkouts = usePrototypeCheckouts();
  const [dialog, setDialog] = useState<MachineDialogPurpose>();
  const now = useNow();

  // Shown, its machines are read again if they are old or failed.
  useEffect(() => {
    void window.verdandi.openCheckouts();
  }, []);

  const rows = useMemo(
    () =>
      checkouts.repositories
        .map((row, index) => ({
          row,
          index,
          attention: prototypeNeedsAttention(row),
        }))
        .toSorted(
          (a, b) =>
            Number(b.attention) - Number(a.attention) || a.index - b.index,
        )
        .map(({ row }) => row),
    [checkouts.repositories],
  );

  return (
    <>
      <header className="shrink-0 border-b">
        <div className="flex min-h-12 items-center gap-2 py-1.5 pr-2 pl-4">
          <h1 className="min-w-0 truncate font-medium">Checkouts</h1>
          <span className="flex-1" />
          <RefreshControl
            freshness={(at) => checkoutsFreshness(checkouts, at)}
            onRefresh={() => {
              void window.verdandi.refresh({ kind: "checkouts" });
            }}
            onRetry={() => {
              void window.verdandi.retry({ kind: "checkouts" });
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDialog({ kind: "new-host" });
            }}
          >
            Add host…
          </Button>
          <Button
            size="sm"
            disabled={checkouts.updating}
            title="Moves each main branch that is only behind GitHub forward, everywhere, and creates those only GitHub has"
            onClick={() => {
              void window.verdandi.updateAllCheckouts();
            }}
          >
            {checkouts.updating ? "Updating…" : "Update all"}
          </Button>
        </div>
        {checkouts.lastUpdate && (
          <p role="status" className="px-4 pb-2 text-xs text-muted-foreground">
            {updateSummaryText(checkouts.lastUpdate, now)}
          </p>
        )}
      </header>
      <div
        data-pane-focus
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto outline-none"
      >
        {rows.length === 0 ? (
          <p className="p-4 text-muted-foreground">
            Track repositories to see their checkouts here.
          </p>
        ) : (
          <table className="w-full border-separate border-spacing-0">
            <thead className="sticky top-0 z-10 bg-background">
              <tr>
                <th className="border-b px-4 py-2 text-left align-top text-xs font-medium text-muted-foreground">
                  Repository
                </th>
                {checkouts.machines.map((machine) => (
                  <th
                    key={machineKey(machine)}
                    className="border-b px-3 py-2 text-left align-top font-normal"
                  >
                    <MachineHeading
                      machine={machine}
                      onChange={() => {
                        setDialog(
                          machine.kind === "host"
                            ? { kind: "host", host: machine.host }
                            : {
                                kind: "this",
                                name: machineName(machine),
                                folders: machine.folders,
                              },
                        );
                      }}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ repository, cells }) => (
                <tr
                  key={`${repository.owner}/${repository.name}`}
                  className="hover:bg-muted/30"
                >
                  <td className="border-b px-4 py-2 align-top">
                    <span className="flex flex-col leading-tight">
                      <span>{repository.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {repository.owner}
                      </span>
                    </span>
                  </td>
                  {cells.map((cell, index) => {
                    const machine = checkouts.machines[index];
                    return (
                      <td
                        key={machine ? machineKey(machine) : index}
                        className="border-b px-3 py-2 align-top"
                      >
                        <Cell
                          cell={cell}
                          machine={machine}
                          repository={`${repository.owner}/${repository.name}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {/* PROTOTYPE (checkout switch) */}
      <PrototypeSwitcher />
      {dialog && (
        <MachineDialog
          purpose={dialog}
          onClose={() => {
            setDialog(undefined);
          }}
        />
      )}
    </>
  );
}

/**
 * A machine's column heading: its name, its folders, and how reading it
 * goes, or why it failed; with a button to change it.
 */
function MachineHeading({
  machine,
  onChange,
}: {
  machine: Machine;
  onChange: () => void;
}) {
  const { loading } = machine;
  const problem =
    loading.status === "failed" || loading.status === "stale"
      ? machineProblemText(loading.problem)
      : undefined;
  return (
    <div className="flex min-w-40 flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span className="font-medium">{machineName(machine)}</span>
        <button
          type="button"
          onClick={onChange}
          className="rounded px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          Change…
        </button>
      </div>
      <span
        className="truncate font-mono text-2xs text-muted-foreground"
        title={
          machine.kind === "host"
            ? `${machine.host.address}: ${machine.folders.join(", ")}`
            : machine.folders.join(", ")
        }
      >
        {machine.kind === "host" ? `${machine.host.address} · ` : ""}
        {machine.folders.join(", ")}
      </span>
      {loading.status === "loading" && (
        <span className="text-xs text-muted-foreground">Reading…</span>
      )}
      {problem && (
        <span
          role="alert"
          title={[problem.text, problem.hint].filter(Boolean).join("\n\n")}
          className="flex items-start gap-1 text-xs text-warning"
        >
          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          <span className="line-clamp-2">{problem.text}</span>
        </span>
      )}
    </div>
  );
}

/** A tracked repository's checkouts on one machine. */
function Cell({
  cell,
  machine,
  repository,
}: {
  cell: CheckoutCell;
  machine: Machine | undefined;
  repository: string;
}) {
  if (cell.status === "unknown")
    return (
      <span
        className="text-muted-foreground"
        title={
          machine?.loading.status === "failed"
            ? "Not read: the machine could not be read"
            : "Not read yet"
        }
      >
        –
      </span>
    );
  if (cell.status !== "found")
    return <span className="text-xs text-muted-foreground">No checkout</span>;
  return (
    <div className="flex flex-col gap-2">
      {cell.groups.map((group, index) =>
        machine ? (
          <PrototypeGroup
            key={index}
            group={group}
            repository={repository}
            machine={machine}
            index={index}
          />
        ) : (
          <Group key={index} group={group} />
        ),
      )}
    </div>
  );
}

/**
 * Checkouts that share their branches: the main branches, each where it
 * stands, then each checkout, with the branch checked out when it is no
 * main branch, and its changed files.
 */
function Group({ group }: { group: CheckoutGroup }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {group.mainBranches.length === 0 ? (
          <span className="text-xs text-muted-foreground">No main branch</span>
        ) : (
          group.mainBranches.map((branch) => (
            <BranchChip key={branch.name} branch={branch} />
          ))
        )}
      </div>
      {group.checkouts.map((checkout) => (
        <CheckoutLine
          key={checkout.path}
          checkout={checkout}
          mainBranch={group.mainBranches.some(
            ({ name }) => name === checkout.branch,
          )}
        />
      ))}
      {!group.fetch.ok && (
        <span
          title={group.fetch.message}
          className="flex items-start gap-1 text-xs text-warning"
        >
          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          <span className="line-clamp-2">
            Could not fetch from GitHub: {group.fetch.message}
          </span>
        </span>
      )}
    </div>
  );
}

/** A main branch, where it stands, and why Update all left it, if it did. */
function BranchChip({ branch }: { branch: MainBranch }) {
  const state = branchState(branch);
  const stuck = branch.stuck;
  const why =
    stuck === undefined
      ? undefined
      : stuck.reason === "checked-out-elsewhere"
        ? `Update all left it: it is checked out in the worktree ${stuck.message}, where an agent may work.`
        : `Update all left it: ${stuck.message}`;
  return (
    <span
      title={[state.title, why].filter(Boolean).join("\n")}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 font-mono text-2xs leading-5 tabular-nums",
        tones[state.tone],
      )}
    >
      {state.text}
      {stuck && (
        <TriangleAlert aria-label={why} className="size-3 text-warning" />
      )}
    </span>
  );
}

/**
 * A checkout: where it is, the branch checked out when it is no main
 * branch, and how many files are changed.
 */
function CheckoutLine({
  checkout,
  mainBranch,
}: {
  checkout: Checkout;
  /** Whether the branch checked out is a main branch. */
  mainBranch: boolean;
}) {
  const { path, branch, changedFiles } = checkout;
  const details = [
    ...(branch === undefined
      ? ["no branch checked out"]
      : mainBranch
        ? []
        : [`on ${branch}`]),
    ...(changedFiles > 0
      ? [
          `${String(changedFiles)} changed ${changedFiles === 1 ? "file" : "files"}`,
        ]
      : []),
  ];
  return (
    <span
      title={[path, ...details].join(" · ")}
      className="flex min-w-0 gap-1 text-xs text-muted-foreground"
    >
      <span className="truncate font-mono text-2xs leading-4">{path}</span>
      {details.length > 0 && (
        <span className="shrink-0 truncate">· {details.join(" · ")}</span>
      )}
    </span>
  );
}
