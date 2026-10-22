/**
 * PROTOTYPE, throw away: seeing the branch a clone has checked out, and
 * switching it back to a main branch from Checkouts.
 *
 * Three variants of a cell, switchable with the floating bar at the bottom
 * (or ⌥← / ⌥→). Every one highlights the main branch the clone's own
 * checkout is on, marks a clone on no main branch and moves its repository
 * up, and leaves worktrees as they are:
 *
 * - A: the chips are the switch: the active one is filled, a click on
 *   another switches; a clone on no main branch says so in its line
 * - B: the branch checked out always leads the chips, a warning chip when it
 *   is no main branch; a click on a main branch switches
 * - C: the chips only show; a clone on no main branch gets a box with
 *   "Switch to main" buttons, the only way to switch
 *
 * The data is made up, not read: switching is a stub that takes a moment,
 * and fails for acme/infra, whose main is checked out in a worktree.
 * **Reset** in the bar brings the made-up data back. Lives only on the
 * branch `prototype/checkout-switch`.
 */
import type {
  CheckoutGroup,
  Machine,
  MainBranch,
} from "@verdandi/core/contract";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import {
  branchState,
  machineKey,
  needsAttention,
  type BranchState,
} from "./checkouts";
import type { CheckoutsOn } from "./sidebar-entries";

export type Variant = "A" | "B" | "C";

const variants: readonly { key: Variant; name: string }[] = [
  { key: "A", name: "Chips are the switch" },
  { key: "B", name: "Branch leads the chips" },
  { key: "C", name: "Switch-back box" },
];

// The variant, from `?variant=` at launch, then in memory.
let variant: Variant =
  (new URLSearchParams(location.search).get("variant") as Variant | null) ??
  "A";
const variantListeners = new Set<() => void>();
function setVariant(next: Variant) {
  variant = next;
  try {
    const url = new URL(location.href);
    url.searchParams.set("variant", next);
    history.replaceState(history.state, "", url);
  } catch {
    // A file:// page may refuse; memory is enough.
  }
  for (const listener of variantListeners) listener();
}
export function useVariant(): Variant {
  return useSyncExternalStore(
    (listener) => {
      variantListeners.add(listener);
      return () => variantListeners.delete(listener);
    },
    () => variant,
  );
}

// ---------------------------------------------------------------------------
// Made-up checkouts, with `worktree` as the real contract would get it.

interface ProtoCheckout {
  path: string;
  branch: string | undefined;
  changedFiles: number;
  worktree: boolean;
}
type ProtoGroup = Omit<CheckoutGroup, "checkouts"> & {
  checkouts: ProtoCheckout[];
};

const upToDate = { status: "tracking", ahead: 0, behind: 0 } as const;
const behind = (count: number) =>
  ({ status: "tracking", ahead: 0, behind: count }) as const;

function group(
  checkouts: ProtoCheckout[],
  branches: Record<string, MainBranch["upstream"]>,
): ProtoGroup {
  return {
    checkouts,
    mainBranches: Object.entries(branches).map(([name, upstream]) => ({
      name,
      upstream,
    })),
    fetch: { ok: true },
  };
}
const clone = (path: string, branch: string, changedFiles = 0) => ({
  path,
  branch,
  changedFiles,
  worktree: false,
});
const worktree = (path: string, branch: string, changedFiles = 0) => ({
  path,
  branch,
  changedFiles,
  worktree: true,
});

function madeUp(): CheckoutsOn {
  const now = Date.now();
  const found = (...groups: ProtoGroup[]) => ({
    status: "found" as const,
    groups: groups as unknown as CheckoutGroup[],
  });
  return {
    status: "on",
    machines: [
      {
        kind: "this",
        folders: ["~/code"],
        loading: { status: "current", updatedAt: now - 60_000 },
      },
      {
        kind: "host",
        host: {
          id: "nuc",
          name: "NUC",
          address: "nuc.example.ts.net",
          folders: ["~/code"],
        },
        folders: ["~/code"],
        loading: { status: "current", updatedAt: now - 60_000 },
      },
    ],
    repositories: [
      {
        repository: { owner: "acme", name: "api" },
        cells: [
          found(
            group([clone("~/code/api", "main")], {
              main: upToDate,
              dev: upToDate,
            }),
          ),
          found(group([clone("~/code/api", "main")], { main: behind(2) })),
        ],
      },
      {
        repository: { owner: "acme", name: "web" },
        cells: [
          found(
            group([clone("~/code/web", "dev")], {
              main: upToDate,
              dev: upToDate,
            }),
          ),
          { status: "none" },
        ],
      },
      {
        repository: { owner: "acme", name: "shop" },
        cells: [
          found(
            group([clone("~/code/shop", "prototype/new-checkout")], {
              main: upToDate,
              dev: behind(1),
            }),
          ),
          found(group([clone("~/code/shop", "main")], { main: upToDate })),
        ],
      },
      {
        repository: { owner: "acme", name: "docs" },
        cells: [
          found(
            group([clone("~/code/docs", "merge/release-2", 3)], {
              main: upToDate,
            }),
          ),
          { status: "none" },
        ],
      },
      {
        repository: { owner: "acme", name: "cli" },
        cells: [
          found(
            group(
              [
                clone("~/code/cli", "main"),
                worktree("~/code/cli-agent", "agent/fix-login", 2),
              ],
              { main: upToDate },
            ),
          ),
          found(
            group([clone("~/code/cli", "spike/rust-port")], {
              main: upToDate,
              dev: upToDate,
            }),
          ),
        ],
      },
      {
        repository: { owner: "acme", name: "infra" },
        cells: [
          found(
            group(
              [
                clone("~/code/infra", "hotfix/dns"),
                worktree("~/code/infra-main", "main"),
              ],
              { main: upToDate },
            ),
          ),
          { status: "none" },
        ],
      },
    ],
    behind: 2,
    ahead: 0,
    updating: false,
    lastUpdate: undefined,
  };
}

// ---------------------------------------------------------------------------
// The made-up state, with switches under way and those that failed.

/** A group, by its repository, its machine, and its place in the cell. */
export type GroupKey = string;
export const groupKey = (repository: string, machine: Machine, index: number) =>
  `${repository}|${machineKey(machine)}|${String(index)}`;

interface ProtoState {
  data: CheckoutsOn;
  switching: Map<GroupKey, string>;
  failed: Map<GroupKey, { branch: string; message: string }>;
}
let state: ProtoState = {
  data: madeUp(),
  switching: new Map(),
  failed: new Map(),
};
const stateListeners = new Set<() => void>();
function setState(next: ProtoState) {
  state = next;
  for (const listener of stateListeners) listener();
}
function useProtoState(): ProtoState {
  return useSyncExternalStore(
    (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    () => state,
  );
}
function reset() {
  setState({ data: madeUp(), switching: new Map(), failed: new Map() });
}

/** The made-up checkouts, instead of those read. */
export function usePrototypeCheckouts(): CheckoutsOn {
  return useProtoState().data;
}

/** Switches a clone, as the core would: a moment, then done or refused. */
function switchTo(
  key: GroupKey,
  repository: string,
  machine: Machine,
  index: number,
  branch: string,
) {
  const switching = new Map(state.switching).set(key, branch);
  const failed = new Map(state.failed);
  failed.delete(key);
  setState({ ...state, switching, failed });
  setTimeout(() => {
    const switching = new Map(state.switching);
    switching.delete(key);
    if (repository === "acme/infra" && branch === "main") {
      setState({
        ...state,
        switching,
        failed: new Map(state.failed).set(key, {
          branch,
          message:
            "fatal: 'main' is already used by worktree at '~/code/infra-main'",
        }),
      });
      return;
    }
    const data = structuredClone(state.data);
    const row = data.repositories.find(
      (one) => `${one.repository.owner}/${one.repository.name}` === repository,
    );
    const column = data.machines.findIndex(
      (one) => machineKey(one) === machineKey(machine),
    );
    const cell = row?.cells[column];
    const own = (
      cell?.status === "found"
        ? (cell.groups[index]?.checkouts as ProtoCheckout[] | undefined)
        : undefined
    )?.find((one) => !one.worktree);
    if (own) own.branch = branch;
    setState({ ...state, data, switching });
  }, 1400);
}

// ---------------------------------------------------------------------------
// What every variant shares.

function ownOf(group: CheckoutGroup): ProtoCheckout | undefined {
  return (group.checkouts as ProtoCheckout[]).find((one) => !one.worktree);
}
function onMainBranch(group: CheckoutGroup, checkout: ProtoCheckout) {
  return group.mainBranches.some(({ name }) => name === checkout.branch);
}
/** Whether a group's clone is on no main branch while it has one. */
function offMainBranch(group: CheckoutGroup): ProtoCheckout | undefined {
  const own = ownOf(group);
  return own && group.mainBranches.length > 0 && !onMainBranch(group, own)
    ? own
    : undefined;
}

/** As `needsAttention`, and a clone on no main branch. */
export function prototypeNeedsAttention(
  row: CheckoutsOn["repositories"][number],
) {
  return (
    needsAttention(row) ||
    row.cells.some(
      (cell) =>
        cell.status === "found" &&
        cell.groups.some((group) => offMainBranch(group) !== undefined),
    )
  );
}

const tones: Record<BranchState["tone"], string> = {
  current: "text-issue-open",
  behind: "border-selection-edge/50 text-selection-edge",
  ahead: "border-warning/50 text-warning",
  diverged: "border-warning/50 text-warning",
  untracked: "text-muted-foreground",
};
const chip =
  "inline-flex items-center gap-1 rounded border px-1.5 font-mono text-2xs leading-5 tabular-nums";
const active = "border-current bg-current/15 font-semibold";

const files = (count: number) =>
  `${String(count)} changed ${count === 1 ? "file" : "files"}`;

/** Why a clone cannot switch, unless it can. */
function blocked(own: ProtoCheckout): string | undefined {
  return own.changedFiles > 0
    ? `${own.path} has ${files(own.changedFiles)}: commit or stash them to switch.`
    : undefined;
}

function Switching({ branch }: { branch: string }) {
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <LoaderCircle aria-hidden className="size-3 animate-spin" />
      Switching to {branch}…
    </span>
  );
}

function Failed({ failure }: { failure: { branch: string; message: string } }) {
  return (
    <span
      title={failure.message}
      className="flex items-start gap-1 text-xs text-warning"
    >
      <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
      <span className="line-clamp-2">
        Could not switch to {failure.branch}: {failure.message}
      </span>
    </span>
  );
}

/** A checkout's line, with its branch when the variant shows it there. */
function Line({
  checkout,
  group,
  branchInLine,
}: {
  checkout: ProtoCheckout;
  group: CheckoutGroup;
  /** Whether a clone's own on no main branch names it here, in warning. */
  branchInLine: boolean;
}) {
  const { path, branch, changedFiles } = checkout;
  const onMain = onMainBranch(group, checkout);
  const warn = !checkout.worktree && !onMain && group.mainBranches.length > 0;
  const showBranch = !onMain && (checkout.worktree || branchInLine);
  return (
    <span className="flex min-w-0 gap-1 text-xs text-muted-foreground">
      <span className="truncate font-mono text-2xs leading-4">{path}</span>
      {showBranch && (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1",
            warn && "text-warning",
          )}
        >
          <span>·</span>
          {warn && <TriangleAlert aria-hidden className="size-3" />}
          <span>
            {branch === undefined ? "no branch checked out" : `on ${branch}`}
          </span>
        </span>
      )}
      {changedFiles > 0 && (
        <span className="shrink-0">· {files(changedFiles)}</span>
      )}
      {checkout.worktree && (
        <span className="shrink-0 text-muted-foreground/70">· worktree</span>
      )}
    </span>
  );
}

export interface GroupProps {
  group: CheckoutGroup;
  repository: string;
  machine: Machine;
  index: number;
}

// ---------------------------------------------------------------------------
// A: the chips are the switch.

function GroupA({ group, repository, machine, index }: GroupProps) {
  const { switching, failed } = useProtoState();
  const key = groupKey(repository, machine, index);
  const own = ownOf(group);
  const pending = switching.get(key);
  const failure = failed.get(key);
  const why = own && blocked(own);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1" role={own ? "group" : undefined}>
        {group.mainBranches.map((branch) => {
          const state = branchState(branch);
          const isActive = own?.branch === branch.name;
          const canSwitch = own && !isActive && !why && !pending;
          return (
            <button
              key={branch.name}
              type="button"
              aria-pressed={own ? isActive : undefined}
              aria-disabled={!canSwitch}
              title={[
                state.title,
                own &&
                  (isActive
                    ? `Checked out in ${own.path}`
                    : (why ?? `Switch ${own.path} to ${branch.name}`)),
              ]
                .filter(Boolean)
                .join("\n")}
              onClick={() => {
                if (canSwitch)
                  switchTo(key, repository, machine, index, branch.name);
              }}
              className={cn(
                chip,
                tones[state.tone],
                isActive && active,
                canSwitch
                  ? "cursor-pointer hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  : "cursor-default",
              )}
            >
              {state.text}
            </button>
          );
        })}
      </div>
      {(group.checkouts as ProtoCheckout[]).map((checkout) =>
        !checkout.worktree && pending ? (
          <span key={checkout.path} className="flex min-w-0 gap-1">
            <span className="truncate font-mono text-2xs leading-4 text-muted-foreground">
              {checkout.path}
            </span>
            <Switching branch={pending} />
          </span>
        ) : (
          <Line
            key={checkout.path}
            checkout={checkout}
            group={group}
            branchInLine
          />
        ),
      )}
      {failure && <Failed failure={failure} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// B: the branch checked out leads the chips.

function GroupB({ group, repository, machine, index }: GroupProps) {
  const { switching, failed } = useProtoState();
  const key = groupKey(repository, machine, index);
  const own = ownOf(group);
  const off = offMainBranch(group);
  const pending = switching.get(key);
  const failure = failed.get(key);
  const why = own && blocked(own);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {off && (
          <span
            title={`${off.path} is on ${off.branch ?? "no branch"}, no main branch${why ? `\n${why}` : ""}`}
            className={cn(chip, active, "text-warning")}
          >
            <TriangleAlert aria-hidden className="size-3" />
            {off.branch ?? "no branch"}
          </span>
        )}
        {off && group.mainBranches.length > 0 && (
          <span className="text-2xs text-muted-foreground">→</span>
        )}
        {group.mainBranches.map((branch) => {
          const state = branchState(branch);
          const isActive = own?.branch === branch.name;
          const canSwitch = own && !isActive && !why && !pending;
          return (
            <button
              key={branch.name}
              type="button"
              aria-pressed={own ? isActive : undefined}
              aria-disabled={!canSwitch}
              title={[
                state.title,
                own &&
                  (isActive
                    ? `Checked out in ${own.path}`
                    : (why ?? `Switch ${own.path} to ${branch.name}`)),
              ]
                .filter(Boolean)
                .join("\n")}
              onClick={() => {
                if (canSwitch)
                  switchTo(key, repository, machine, index, branch.name);
              }}
              className={cn(
                chip,
                tones[state.tone],
                isActive && active,
                canSwitch
                  ? "cursor-pointer border-dashed hover:border-solid hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  : "cursor-default",
              )}
            >
              {pending === branch.name && (
                <LoaderCircle aria-hidden className="size-3 animate-spin" />
              )}
              {state.text}
            </button>
          );
        })}
      </div>
      {(group.checkouts as ProtoCheckout[]).map((checkout) => (
        <Line
          key={checkout.path}
          checkout={checkout}
          group={group}
          branchInLine={false}
        />
      ))}
      {failure && <Failed failure={failure} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// C: a box with buttons to switch back.

function GroupC({ group, repository, machine, index }: GroupProps) {
  const { switching, failed } = useProtoState();
  const key = groupKey(repository, machine, index);
  const own = ownOf(group);
  const off = offMainBranch(group);
  const pending = switching.get(key);
  const failure = failed.get(key);
  const why = own && blocked(own);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {group.mainBranches.map((branch) => {
          const state = branchState(branch);
          const isActive = own?.branch === branch.name;
          return (
            <span
              key={branch.name}
              title={[
                state.title,
                isActive && own && `Checked out in ${own.path}`,
              ]
                .filter(Boolean)
                .join("\n")}
              className={cn(chip, tones[state.tone], isActive && active)}
            >
              {state.text}
            </span>
          );
        })}
      </div>
      {(group.checkouts as ProtoCheckout[]).map((checkout) => (
        <Line
          key={checkout.path}
          checkout={checkout}
          group={group}
          branchInLine={false}
        />
      ))}
      {off && (
        <div className="flex flex-col gap-1.5 rounded border border-warning/40 bg-warning/5 px-2 py-1.5">
          <span className="flex items-start gap-1 text-xs text-warning">
            <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
            <span>
              On <span className="font-mono">{off.branch ?? "no branch"}</span>,
              no main branch
            </span>
          </span>
          {pending ? (
            <Switching branch={pending} />
          ) : why ? (
            <span className="text-xs text-muted-foreground">{why}</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {group.mainBranches.map((branch) => (
                <button
                  key={branch.name}
                  type="button"
                  onClick={() => {
                    switchTo(key, repository, machine, index, branch.name);
                  }}
                  className="rounded border bg-background px-2 text-xs leading-6 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  Switch to <span className="font-mono">{branch.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {failure && <Failed failure={failure} />}
    </div>
  );
}

export function PrototypeGroup(props: GroupProps) {
  const current = useVariant();
  if (current === "B") return <GroupB {...props} />;
  if (current === "C") return <GroupC {...props} />;
  return <GroupA {...props} />;
}

// ---------------------------------------------------------------------------
// The floating bar.

export function PrototypeSwitcher() {
  const current = useVariant();
  const at = variants.findIndex(({ key }) => key === current);
  const step = (by: number) => {
    const next = variants[(at + by + variants.length) % variants.length];
    if (next) setVariant(next.key);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey) return;
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div
      data-prototype-switcher
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-foreground px-2 py-1 text-sm text-background shadow-lg"
    >
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => step(-1)}
        className="rounded-full p-1 hover:bg-background/20"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="px-2 tabular-nums">
        {current} ({variants[at]?.name})
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => step(1)}
        className="rounded-full p-1 hover:bg-background/20"
      >
        <ChevronRight className="size-4" />
      </button>
      <button
        type="button"
        onClick={reset}
        className="ml-1 rounded-full px-2 py-0.5 text-xs hover:bg-background/20"
      >
        Reset
      </button>
    </div>
  );
}
