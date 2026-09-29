import type {
  RepositoryAddress,
  TrackedRepository,
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
  /**
   * Tracks repositories, in order, with their GitHub IDs: an entry with the
   * same ID, or else the same name without an ID, takes the current name and
   * ID where it is; any other goes to the end of the section. Creates the
   * file if there is none.
   */
  addRepositories(
    repositories: readonly (RepositoryAddress & { id: number })[],
  ): Promise<SettingsChangeResult>;
  /**
   * Gives tracked repositories their current name and ID where they are:
   * each entry found by its ID, or else by its name without an ID. An entry
   * left with the ID of one higher in the sidebar is removed. Says which
   * updates found their entry.
   */
  updateRepositories(
    updates: readonly RepositoryUpdate[],
  ): Promise<
    { ok: true; updated: RepositoryUpdate[] } | { ok: false; message: string }
  >;
  /**
   * Removes the entries that have the ID of one higher in the sidebar, as
   * `read` leaves them out, and says which it removed.
   */
  removeDuplicateRepositories(): Promise<
    | { ok: true; removed: RepositoryDuplicate[] }
    | { ok: false; message: string }
  >;
  /** Removes this sidebar entry; views are kept verbatim. */
  removeRepository(
    repository: TrackedRepository,
  ): Promise<SettingsChangeResult>;
  /**
   * Saves a view: the one with its ID takes its name and search where it is;
   * any other goes right after the view with the ID `after`, or to the end
   * of the section when there is none. Creates the file if there is none.
   */
  saveView(view: SavedView, after?: string): Promise<SettingsChangeResult>;
  /** Removes the view with this ID; repositories are kept verbatim. */
  removeView(id: string): Promise<SettingsChangeResult>;
  /** Creates the file empty if there is none; an existing one stays as it is. */
  createIfMissing(): Promise<SettingsChangeResult>;
}

/** A tracked repository as the settings file has it, and as GitHub has it now. */
export interface RepositoryUpdate {
  entry: TrackedRepository;
  current: RepositoryAddress & { id: number };
}

/** An entry with the same GitHub ID as one higher in the sidebar. */
export interface RepositoryDuplicate {
  repository: RepositoryAddress;
  sameAs: RepositoryAddress;
}

/** Portable user data as the core and sidebar use it. */
export interface Settings {
  /** The tracked repositories, in sidebar order. */
  repositories: TrackedRepository[];
  views: SavedView[];
}

export type SettingsResult =
  | {
      ok: true;
      value: Settings;
      status: SettingsStatus;
      /** Whether the file exists; if not, nothing is tracked yet. */
      exists: boolean;
      /**
       * The entries left out of `value` as they have the ID of one higher
       * in the sidebar, which is the repository's.
       */
      duplicates: RepositoryDuplicate[];
    }
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
