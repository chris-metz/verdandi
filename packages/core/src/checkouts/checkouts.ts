import {
  defaultCheckoutFolders,
  type CheckoutCell,
  type CheckoutGroup,
  type Checkouts,
  type Config,
  type Host,
  type Machine,
  type MachineLoading,
  type MachineProblem,
  type UpdateSummary,
} from "../contract.ts";
import {
  atOrAfter,
  fiveMinutesAgo,
  type Clock,
  type Moment,
} from "../moments.ts";
import { repositoryKey } from "../repository-address.ts";
import type { LocalStateStorage, SettingsStorage } from "../settings/port.ts";
import type {
  CheckoutReader,
  MachineAddress,
  MachineReport,
  ReportedGroup,
} from "./port.ts";

/**
 * Checkouts: what is known of the checkouts on each machine, and when they
 * are read again. A machine is read when it was never read, its report does
 * not cover every tracked repository, it failed, or it is older than five
 * minutes, as screens open or are shown again; every machine at once on a
 * refresh; and a machine whose folders, address or main branches changed
 * as soon as they do. Each machine is read by one read at a time, and Update
 * all waits for a read under way.
 */
export interface CheckoutsModule {
  /** Checkouts as they are now, reading every machine the first time. */
  read(): Promise<Checkouts>;
  /** Reads the machines never read, failed, or older than five minutes. */
  revalidate(): void;
  /** Reads every machine again now. */
  refresh(): void;
  /** Reads the machines that failed again now. */
  retry(): void;
  /** Brings every machine's main branches up to date, then sums it up. */
  updateAll(): void;
  /**
   * Hears that `config.toml`, `settings.json` or this machine's folders
   * changed: pushes Checkouts, and reads the machines that need it.
   */
  changed(): void;
}

export interface CheckoutsOptions {
  /** Reads checkouts, unless Verdandi cannot run git where it runs. */
  reader: CheckoutReader | undefined;
  settings: SettingsStorage;
  localState: LocalStateStorage;
  /** How `config.toml` is now. */
  config: () => Promise<Config>;
  /** Folders to look for programs in first on this machine: gh's, once found. */
  programFolders: () => string[];
  clock: Clock;
  /** Pushes Checkouts to the interfaces. */
  push: (checkouts: Checkouts) => void;
}

/** A machine as Checkouts reads it now. */
interface Target {
  key: string;
  address: MachineAddress;
  folders: string[];
  host: Host | undefined;
}

/** What is known of a machine. */
interface MachineState {
  /**
   * What its report was read with but the repositories: address, folders
   * and main branches. A report read with others no longer fits.
   */
  basis: string;
  /** Its checkout groups, as last read. */
  groups: ReportedGroup[] | undefined;
  /** The tracked repositories its report covers, in lower case. */
  covered: Set<string>;
  /** When its last read that worked started. */
  readAt: Moment | undefined;
  /** Why its last read failed, unless it worked. */
  problem: MachineProblem | undefined;
  /** How many reads are queued or under way. */
  busy: number;
  /** Its reads, one after another. */
  queue: Promise<unknown>;
}

export function createCheckouts({
  reader,
  settings,
  localState,
  config,
  programFolders,
  clock,
  push,
}: CheckoutsOptions): CheckoutsModule {
  const states = new Map<string, MachineState>();
  let started = false;
  let updating = false;
  let lastUpdate: UpdateSummary | undefined;

  /**
   * What Checkouts reads now, unless it is off: each machine, the tracked
   * repositories and the main branches.
   */
  async function planned() {
    if (!reader) return undefined;
    const { checkouts, mainBranches } = await config();
    if (!checkouts) return undefined;
    const [{ value }, local] = await Promise.all([
      settings.read(),
      localState.read(),
    ]);
    const targets: Target[] = [
      {
        key: "this",
        address: { kind: "this" },
        folders: local.checkoutFolders ?? [...defaultCheckoutFolders],
        host: undefined,
      },
      ...value.hosts.map((host) => ({
        key: `host:${host.id}`,
        address: { kind: "host" as const, address: host.address },
        folders: host.folders,
        host,
      })),
    ];
    return {
      targets,
      mainBranches,
      repositories: value.repositories.map(({ owner, name }) => ({
        owner,
        name,
      })),
    };
  }
  type Plan = NonNullable<Awaited<ReturnType<typeof planned>>>;

  /** A machine's state, a new one once what it reads with changed. */
  function stateOf(target: Target, plan: Plan): MachineState {
    const basis = JSON.stringify([
      target.address,
      target.folders,
      plan.mainBranches,
    ]);
    const known = states.get(target.key);
    if (known?.basis === basis) return known;
    const state: MachineState = {
      basis,
      groups: undefined,
      covered: new Set(),
      readAt: undefined,
      problem: undefined,
      busy: known?.busy ?? 0,
      queue: known?.queue ?? Promise.resolve(),
    };
    states.set(target.key, state);
    return state;
  }

  /**
   * Reads a machine, after any read of it under way, bringing its main
   * branches up to date if asked to, and pushes Checkouts as it starts and
   * ends.
   */
  function read(
    target: Target,
    plan: Plan,
    update: boolean,
  ): Promise<MachineReport> {
    const state = stateOf(target, plan);
    state.busy++;
    const done = state.queue.then(async () => {
      const startedAt = clock();
      const repositories = plan.repositories;
      let report: MachineReport;
      try {
        report = await (reader as CheckoutReader).read(target.address, {
          folders: target.folders,
          repositories,
          mainBranches: plan.mainBranches,
          update,
          programFolders: programFolders(),
        });
      } catch (error) {
        report = {
          ok: false,
          problem: {
            kind: "failed",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
      // What it was read for may have changed meanwhile.
      if (states.get(target.key) === state) {
        if (report.ok) {
          state.groups = report.groups;
          state.covered = new Set(repositories.map(repositoryKey));
          state.readAt = startedAt;
          state.problem = undefined;
        } else state.problem = report.problem;
      }
      return report;
    });
    state.queue = done.catch(() => undefined);
    void pushNow();
    return done.finally(() => {
      state.busy--;
      void pushNow();
    });
  }

  /** Reads the machines that `needs` says need it, unless being read. */
  async function readEach(needs: (state: MachineState, plan: Plan) => boolean) {
    const plan = await planned();
    if (!plan) return;
    for (const target of plan.targets) {
      const state = stateOf(target, plan);
      if (state.busy === 0 && needs(state, plan))
        void read(target, plan, false);
    }
  }

  const outdated = (state: MachineState, plan: Plan) =>
    state.groups === undefined ||
    state.problem !== undefined ||
    state.readAt === undefined ||
    !atOrAfter(state.readAt, fiveMinutesAgo(clock)) ||
    plan.repositories.some(
      (repository) => !state.covered.has(repositoryKey(repository)),
    );

  async function build(): Promise<Checkouts> {
    if (!reader) return { status: "unavailable" };
    const plan = await planned();
    if (!plan) return { status: "off" };
    const machines: Machine[] = plan.targets.map((target) => {
      const state = stateOf(target, plan);
      const loading = loadingOf(state);
      return target.host
        ? { kind: "host", host: target.host, folders: target.folders, loading }
        : { kind: "this", folders: target.folders, loading };
    });
    let behind = 0;
    let ahead = 0;
    const repositories = plan.repositories.map((repository) => ({
      repository,
      cells: plan.targets.map((target): CheckoutCell => {
        const state = stateOf(target, plan);
        if (!state.groups || !state.covered.has(repositoryKey(repository)))
          return { status: "unknown" };
        const groups = state.groups
          .filter(
            (group) =>
              repositoryKey(group.repository) === repositoryKey(repository),
          )
          .map(({ checkouts, mainBranches, fetch }): CheckoutGroup => ({
            checkouts,
            mainBranches,
            fetch,
          }));
        for (const { mainBranches } of groups) {
          const tracking = mainBranches.flatMap(({ upstream }) =>
            upstream.status === "tracking" ? [upstream] : [],
          );
          if (tracking.some(({ behind }) => behind > 0)) behind++;
          if (tracking.some(({ ahead }) => ahead > 0)) ahead++;
        }
        return groups.length === 0
          ? { status: "none" }
          : { status: "found", groups };
      }),
    }));
    return {
      status: "on",
      machines,
      repositories,
      behind,
      ahead,
      updating,
      lastUpdate,
    };
  }

  async function pushNow() {
    push(await build());
  }

  return {
    async read() {
      const checkouts = await build();
      if (checkouts.status === "on" && !started) {
        started = true;
        void readEach(outdated);
      }
      return checkouts;
    },
    revalidate() {
      void readEach(outdated);
    },
    refresh() {
      void readEach(() => true);
    },
    retry() {
      void readEach(
        (state) => state.problem !== undefined || state.groups === undefined,
      );
    },
    updateAll() {
      void (async () => {
        if (updating) return;
        const plan = await planned();
        if (!plan) return;
        updating = true;
        void pushNow();
        const reports = await Promise.all(
          plan.targets.map((target) => read(target, plan, true)),
        );
        const summary: UpdateSummary = {
          at: clock().time,
          moved: 0,
          created: 0,
          stuck: 0,
          failedMachines: 0,
        };
        for (const report of reports) {
          if (!report.ok) {
            summary.failedMachines++;
            continue;
          }
          summary.moved += report.moved;
          summary.created += report.created;
          // A branch that went apart from GitHub is behind it too, and stays.
          for (const { mainBranches } of report.groups)
            summary.stuck += mainBranches.filter(
              ({ stuck, upstream }) =>
                stuck !== undefined ||
                (upstream.status === "tracking" &&
                  upstream.ahead > 0 &&
                  upstream.behind > 0),
            ).length;
        }
        lastUpdate = summary;
        updating = false;
        await pushNow();
      })();
    },
    changed() {
      void (async () => {
        const plan = await planned();
        // Machines no longer there are forgotten.
        const keys = new Set(plan?.targets.map(({ key }) => key));
        for (const key of states.keys()) if (!keys.has(key)) states.delete(key);
        await pushNow();
        if (!plan) return;
        started = true;
        await readEach(outdated);
      })();
    },
  };
}

/** How far reading a machine has come, as its state says. */
function loadingOf(state: MachineState): MachineLoading {
  const { groups, readAt, problem, busy } = state;
  if (groups && readAt) {
    if (busy > 0) return { status: "refreshing", updatedAt: readAt.time };
    if (problem) return { status: "stale", updatedAt: readAt.time, problem };
    return { status: "current", updatedAt: readAt.time };
  }
  if (problem && busy === 0) return { status: "failed", problem };
  return { status: "loading" };
}
