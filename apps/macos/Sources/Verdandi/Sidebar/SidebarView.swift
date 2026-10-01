import SwiftUI
import VerdandiCore

/// All, the tracked repositories and the views.
struct SidebarView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    @Bindable var model = model
    List(selection: $model.selection) {
      Label("All", systemImage: "square.stack.3d.up")
        .badge(model.sidebar.allCount.map { Text($0, format: .number) })
        .tag(SidebarItem.all)

      Section("Repositories") {
        ForEach(model.settings.repositories) { repository in
          RepositoryRow(repository: repository)
            .tag(SidebarItem.repository(repository.address))
        }
      }

      Section("Views") {
        ForEach(model.settings.views) { view in
          Label(view.name, systemImage: "line.3.horizontal.decrease.circle")
            .tag(SidebarItem.view(id: view.id))
        }
      }
    }
    .navigationTitle("Verdandi")
    .task(id: model.settings.repositories) { await model.sidebar.refreshSummaries() }
    .safeAreaInset(edge: .bottom) {
      if let login = model.login {
        HStack(spacing: 6) {
          Image(systemName: "person.crop.circle")
          Text("@\(login)")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
      }
    }
  }
}

struct RepositoryRow: View {
  @Environment(AppModel.self) private var model
  var repository: TrackedRepository

  var body: some View {
    Label {
      VStack(alignment: .leading, spacing: 0) {
        Text(repository.address.name)
        Text(repository.address.owner).font(.caption).foregroundStyle(.secondary)
      }
    } icon: {
      Image(systemName: "book.closed")
    }
    .badge(model.sidebar.summaries[repository.address].map { Text($0.openIssueCount, format: .number) })
  }
}

extension SidebarStore {
  /// How many open issues the tracked repositories have together, once
  /// every one has said.
  var allCount: Int? {
    let counts = model.settings.repositories.map { summaries[$0.address]?.openIssueCount }
    guard counts.allSatisfy({ $0 != nil }) else { return nil }
    return counts.reduce(0) { $0 + ($1 ?? 0) }
  }
}
