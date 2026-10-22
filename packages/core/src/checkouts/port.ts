import type {
  CheckoutGroup,
  CheckoutSwitch,
  CheckoutSwitchResult,
  MachineProblem,
  RepositoryAddress,
} from "../contract.ts";

/**
 * The checkout-reading port: reads the checkouts of tracked repositories on
 * one machine, and brings their main branches up to date. Each call fetches
 * from GitHub first, and asks nothing of anyone: whatever would ask, such as
 * a password or a key's passphrase, fails instead.
 */
export interface CheckoutReader {
  read(machine: MachineAddress, job: CheckoutJob): Promise<MachineReport>;
}

/** This machine, or a host reached with `ssh`. */
export type MachineAddress =
  { kind: "this" } | { kind: "host"; address: string };

export interface CheckoutJob {
  /** Where checkouts are looked for, a few levels deep, `~` for the home folder. */
  folders: readonly string[];
  /** The tracked repositories whose checkouts are read. */
  repositories: readonly RepositoryAddress[];
  /** The names of the main branches. */
  mainBranches: readonly string[];
  /**
   * Whether to bring the main branches up to date, as Update all does, or
   * only to read them.
   */
  update: boolean;
  /**
   * The clone to switch to a main branch before reading, by its path as
   * the report names it: only a clone's own checkout without changed
   * files switches, never a worktree.
   */
  switchTo?: Omit<CheckoutSwitch, "machine"> | undefined;
  /**
   * Folders where programs are looked for first, on this machine only, e.g.
   * the one gh is in, which git's credential helper may run.
   */
  programFolders?: readonly string[];
}

/**
 * The checkouts found on a machine, and what bringing them up to date did:
 * how many main branches it moved forward and how many it created; and
 * whether the clone switched, when one was to.
 */
export type MachineReport =
  | {
      ok: true;
      groups: ReportedGroup[];
      moved: number;
      created: number;
      switched?: CheckoutSwitchResult;
    }
  | { ok: false; problem: MachineProblem };

/** A checkout group, with the tracked repository it belongs to. */
export interface ReportedGroup extends CheckoutGroup {
  repository: RepositoryAddress;
}
