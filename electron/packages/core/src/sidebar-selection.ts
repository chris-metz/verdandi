import type { CoreRequests, SidebarSelection } from "./contract.ts";
import { nameWithOwner, sameRepository } from "./repository-address.ts";
import type { LocalStateStorage, SettingsStorage } from "./settings/port.ts";

/** Remembers only the sidebar destination, never navigation within its list. */
export function createSidebarSelection(
  settings: SettingsStorage,
  localState: LocalStateStorage,
): Pick<CoreRequests, "getSelectedSidebarEntry" | "selectSidebarEntry"> {
  return {
    async getSelectedSidebarEntry(): Promise<SidebarSelection> {
      const { selectedEntry } = await localState.read();
      const { value } = await settings.read();
      if (selectedEntry?.kind === "repository") {
        const repository = value.repositories.find((repository) =>
          "id" in selectedEntry
            ? repository.id === selectedEntry.id
            : nameWithOwner(repository).toLowerCase() ===
              selectedEntry.name.toLowerCase(),
        );
        if (repository)
          return {
            kind: "repository",
            repository: { owner: repository.owner, name: repository.name },
          };
      }
      if (selectedEntry?.kind === "view") {
        const view = value.views.find(({ id }) => id === selectedEntry.id);
        if (view) return { kind: "view", view };
      }
      return { kind: "all" };
    },
    selectSidebarEntry(entry) {
      // Enqueue before resolving identity, so a later selection or window
      // close cannot overtake this change while settings are being read.
      return localState.update(async () => {
        if (entry.kind !== "repository") return { selectedEntry: entry };
        const { value } = await settings.read();
        const repository = value.repositories.find((repository) =>
          sameRepository(repository, entry.repository),
        );
        return {
          selectedEntry:
            repository?.id === undefined
              ? { kind: "repository", name: nameWithOwner(entry.repository) }
              : { kind: "repository", id: repository.id },
        };
      });
    },
  };
}
