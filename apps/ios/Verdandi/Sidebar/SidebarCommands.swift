import SwiftUI
import VerdandiKit

/// The Sidebar menu of an iPad's menu bar, which a keyboard reaches too:
/// ⌘1…9 choose the sidebar's entries in the order they show, and the menu
/// adds a repository or a view, as the sidebar's buttons do.
struct SidebarCommands: Commands {
    let model: AppModel

    var body: some Commands {
        CommandMenu("Sidebar") {
            ForEach(Array(entries.enumerated()), id: \.offset) { index, entry in
                Button(entry.title) { model.select(entry.item) }
                    .keyboardShortcut(KeyEquivalent(Character(String(index + 1))), modifiers: .command)
            }
            Divider()
            Button("Add Repository…") { SidebarActions(model: model).addRepository() }
                .disabled(!canAdd)
            Button("New View…") { SidebarActions(model: model).newView() }
                .disabled(!canAdd)
        }
    }

    private var canAdd: Bool {
        SidebarActions(model: model).canChange && model.sheet == nil
    }

    /// The entries ⌘1…9 choose: All, then the repositories, then the views.
    private var entries: [(item: SidebarItem, title: String)] {
        guard case .read(let entries) = model.sidebar, isReady else { return [] }
        let all: [(item: SidebarItem, title: String)] = [(.all, "All")]
        let repositories = entries.repositories.map {
            (item: SidebarItem.repository($0.repository.address), title: $0.repository.address.nameWithOwner)
        }
        let views = entries.views.map { (item: SidebarItem.view(id: $0.view.id), title: $0.view.name) }
        return Array((all + repositories + views).prefix(9))
    }

    /// Whether GitHub can be read, so that the sidebar shows.
    private var isReady: Bool {
        if case .ready = model.setup { return true }
        return false
    }
}
