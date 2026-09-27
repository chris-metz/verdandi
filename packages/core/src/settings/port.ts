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
