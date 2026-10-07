import type {
  CoreRequests,
  RestoredTab,
  SidebarEntryKey,
  SidebarSelection,
  TrackedRepository,
} from "./contract.ts";
import { nameWithOwner, sameRepository } from "./repository-address.ts";
import type {
  LocalStateStorage,
  Settings,
  SettingsStorage,
  StoredRepository,
  StoredSidebarEntry,
} from "./settings/port.ts";

/**
 * Keeps the tabs over the main area on this machine: each tab's entry and
 * the issue pages opened from its list, never the place within them.
 */
export function createTabs(
  settings: SettingsStorage,
  localState: LocalStateStorage,
): Pick<CoreRequests, "getTabs" | "saveTabs"> {
  return {
    async getTabs() {
      const { tabs, selectedEntry } = await localState.read();
      const { value } = await settings.read();
      const stored = tabs ?? {
        tabs: [
          {
            kind: "entry",
            entry: selectedEntry ?? { kind: "all" },
            issues: [],
          },
        ],
        shown: 0,
      };
      return {
        tabs: stored.tabs.map((tab): RestoredTab =>
          tab.kind === "new"
            ? { kind: "new", from: tab.from && trackedOf(value, tab.from) }
            : {
                kind: "entry",
                entry: entryOf(value, tab.entry),
                issues: tab.issues,
              },
        ),
        shown: stored.shown,
      };
    },
    saveTabs({ tabs, shown }) {
      // Enqueue before resolving identity, so a later change or window close
      // cannot overtake this one while settings are being read.
      return localState.update(async () => {
        const { value } = await settings.read();
        return {
          tabs: {
            tabs: tabs.map((tab) =>
              tab.kind === "new"
                ? {
                    kind: "new",
                    from: tab.from && storedRepository(value, tab.from),
                  }
                : {
                    kind: "entry",
                    entry: storedEntry(value, tab.entry),
                    issues: tab.issues,
                  },
            ),
            shown,
          },
          // The tab shown takes the place of the entry selected last.
          selectedEntry: undefined,
        };
      });
    },
  };
}

/**
 * A stored entry as the sidebar lists it now: All in place of one that is
 * gone.
 */
function entryOf(
  settings: Settings,
  entry: StoredSidebarEntry,
): SidebarSelection {
  if (entry.kind === "repository") {
    const repository = trackedOf(settings, entry);
    if (repository) return { kind: "repository", repository };
  }
  if (entry.kind === "view") {
    const view = settings.views.find(({ id }) => id === entry.id);
    if (view) return { kind: "view", view };
  }
  return { kind: "all" };
}

/**
 * The tracked repository a stored one is now: the one with its ID, or with
 * its name in any case. Its ID comes along, so that removing it removes
 * that one even after another took over its name.
 */
function trackedOf(
  settings: Settings,
  stored: StoredRepository,
): TrackedRepository | undefined {
  const repository = settings.repositories.find((repository) =>
    "id" in stored
      ? repository.id === stored.id
      : nameWithOwner(repository).toLowerCase() === stored.name.toLowerCase(),
  );
  return (
    repository && {
      owner: repository.owner,
      name: repository.name,
      ...(repository.id === undefined ? {} : { id: repository.id }),
    }
  );
}

/** An entry as it is stored: a tracked repository by its ID, once known. */
function storedEntry(
  settings: Settings,
  entry: SidebarEntryKey | { kind: "all" },
): StoredSidebarEntry {
  return entry.kind === "repository"
    ? storedRepository(settings, entry.repository)
    : entry;
}

/**
 * A repository as it is stored: by the ID it comes with, as the sidebar
 * lists it, or else by the ID of the one tracked under its name, once known.
 */
function storedRepository(
  settings: Settings,
  repository: TrackedRepository,
): StoredRepository {
  const id = Number.isSafeInteger(repository.id)
    ? repository.id
    : settings.repositories.find((tracked) =>
        sameRepository(tracked, repository),
      )?.id;
  return id === undefined
    ? { kind: "repository", name: nameWithOwner(repository) }
    : { kind: "repository", id };
}
