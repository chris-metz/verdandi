import SwiftUI
import VerdandiKit

/// The sidebar: All, the tracked repositories and the views, with the
/// account below them.
struct SidebarView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        List(selection: Binding(get: { model.selection }, set: { model.select($0) })) {
            if case .read(let entries) = model.sidebar {
                Label {
                    Text("All")
                } icon: {
                    Image(systemName: "square.stack.3d.up")
                }
                .badge(entries.all.openIssues.count ?? 0)
                .tag(SidebarItem.all)
                Section("Repositories") {
                    ForEach(entries.repositories, id: \.repository) { entry in
                        Label(entry.repository.name, systemImage: "book.closed")
                            .badge(entry.openIssues.count ?? 0)
                            .tag(SidebarItem.repository(entry.repository.address))
                    }
                }
                Section("Views") {
                    ForEach(entries.views, id: \.view.id) { entry in
                        Label(entry.view.name, systemImage: "line.3.horizontal.decrease")
                            .tag(SidebarItem.view(id: entry.view.id))
                    }
                }
            }
        }
        .navigationTitle("Verdandi")
        .toolbar {
            ToolbarItem {
                Button("Add Repository", systemImage: "plus") { model.sheet = .repositoryPicker }
            }
            ToolbarItem {
                Button("Settings", systemImage: "gearshape") { model.sheet = .settings }
            }
        }
    }
}
