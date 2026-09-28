import type {
  RepositoryAddress,
  SavedView,
  SidebarEntryKey,
  SidebarDestination,
  SettingsChangeResult,
  SettingsStatus,
  WindowState,
} from "../contract.ts";

/**
 * The settings-storage port: where the core keeps user data, the tracked
 * repositories and views, including recovery from hand edits.
 */
export interface SettingsStorage {
  /** Reads the user data. If there is none yet, nothing is tracked. */
  read(): Promise<SettingsResult>;
  /** Watches the containing folder, including editor rename replacements. */
  watch(changed: () => void): () => void;
  reset(): Promise<SettingsChangeResult>;
  reorder(
    entry: SidebarEntryKey,
    destination: SidebarDestination,
  ): Promise<SettingsChangeResult>;
}

/** Portable user data as the core and sidebar use it. */
export interface Settings {
  /** The tracked repositories, in sidebar order. */
  repositories: (RepositoryAddress & { id?: number })[];
  views: SavedView[];
}

export type SettingsResult =
  | { ok: true; value: Settings; status: SettingsStatus }
  /** The file cannot be used; value keeps the last valid data (empty at startup). */
  | { ok: false; message: string; value: Settings };

/**
 * The machine-local-state port: what Verdandi keeps for this machine only,
 * apart from the portable user data, so it never syncs or roams.
 */
export interface LocalStateStorage {
  /** Reads the state. State that cannot be read counts as none, silently. */
  read(): Promise<LocalState>;
  /**
   * Changes the state, keeping what else it holds; `undefined` removes a
   * value. Changes and reads wait for earlier changes. A factory resolves
   * a change inside that queue, e.g. looking up a repository ID in settings;
   * it must not call this storage again.
   */
  update(
    change: Partial<LocalState> | (() => Promise<Partial<LocalState>>),
  ): Promise<void>;
}

/** Machine-local state, as far as the core uses it so far. */
export interface LocalState {
  selectedEntry?: StoredSidebarEntry | undefined;
  window?: WindowState | undefined;
  /** The gh executable the user chose, if any. */
  ghExecutable: string | undefined;
}

/** A stable reference, without a view's mutable text or any list state. */
export type StoredSidebarEntry =
  | { kind: "all" }
  | { kind: "repository"; id: number }
  | { kind: "repository"; name: string }
  | { kind: "view"; id: string };
