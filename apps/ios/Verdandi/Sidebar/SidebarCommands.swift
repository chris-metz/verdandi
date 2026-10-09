import SwiftUI
import VerdandiKit

/// The sidebar's entries in the View menu of an iPad's menu bar, beside
/// Show Sidebar, which a keyboard reaches too: ⌘1…9 choose them in the
/// order they show, whether the sidebar is on screen or not.
struct SidebarCommands: Commands {
    let model: AppModel

    var body: some Commands {
        CommandGroup(after: .sidebar) {
            EntryCommands(model: model)
        }
    }
}

/// The entries' commands. A view of its own, so that the menu follows the
/// sidebar as it changes.
private struct EntryCommands: View {
    var model: AppModel

    var body: some View {
        if !entries.isEmpty {
            Divider()
            ForEach(Array(entries.enumerated()), id: \.offset) { index, entry in
                Button(entry.title) { model.select(entry.item) }
                    .keyboardShortcut(KeyEquivalent(Character(String(index + 1))), modifiers: .command)
            }
        }
    }

    /// The entries ⌘1…9 choose: All, then the repositories, then the views,
    /// once GitHub can be read and the sidebar shows them.
    private var entries: [(item: SidebarItem, title: String)] {
        guard model.phase == .running, case .ready = model.setup, case .read(let entries) = model.sidebar
        else { return [] }
        let all: [(item: SidebarItem, title: String)] = [(.all, "All")]
        let repositories = entries.repositories.map {
            (item: SidebarItem.repository($0.repository.address), title: $0.repository.address.nameWithOwner)
        }
        let views = entries.views.map { (item: SidebarItem.view(id: $0.view.id), title: $0.view.name) }
        return Array((all + repositories + views).prefix(9))
    }
}
