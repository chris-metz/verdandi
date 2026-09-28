import type { RepositoryAddress } from "../contract.ts";

/**
 * The settings-storage port: where the core keeps user data, the tracked
 * repositories and views. So far the core only reads it.
 */
export interface SettingsStorage {
  /** Reads the user data. If there is none yet, nothing is tracked. */
  read(): Promise<SettingsResult>;
}

/** User data, as far as the core uses it so far. */
export interface Settings {
  /** The tracked repositories, in sidebar order. */
  repositories: RepositoryAddress[];
}

export type SettingsResult =
  | { ok: true; value: Settings }
  /** The user data exists but cannot be used; `message` says why. */
  | { ok: false; message: string };

/**
 * The machine-local-state port: what Verdandi keeps for this machine only,
 * apart from the portable user data, so it never syncs or roams.
 */
export interface LocalStateStorage {
  /** Reads the state. State that cannot be read counts as none, silently. */
  read(): Promise<LocalState>;
  /**
   * Changes the state, keeping what else it holds; `undefined` removes a
   * value.
   */
  update(change: Partial<LocalState>): Promise<void>;
}

/** Machine-local state, as far as the core uses it so far. */
export interface LocalState {
  /** The gh executable the user chose, if any. */
  ghExecutable: string | undefined;
}
