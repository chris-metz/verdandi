import SwiftUI
import VerdandiCore

/// A sidebar entry's list.
struct IssueListView: View {
  @Environment(AppModel.self) private var model
  var item: SidebarItem

  var body: some View {
    @Bindable var model = model
    let list = model.lists.list(for: item)
    List(selection: $model.selectedIssueID) {
      ForEach(list.matchIDs, id: \.self) { id in
        if let issue = model.issues[id] {
          IssueRow(issue: issue, showsRepository: item == .all || isView)
            .tag(id)
        }
      }
    }
    .overlay {
      switch list.phase {
      case .loading where list.matchIDs.isEmpty:
        ProgressView()
      case .failed(let error) where list.matchIDs.isEmpty:
        ContentUnavailableView("Could Not Load Issues", systemImage: "exclamationmark.triangle", description: Text(error.message))
      case .loaded where list.matchIDs.isEmpty:
        ContentUnavailableView("No Issues", systemImage: "tray")
      default:
        EmptyView()
      }
    }
    .navigationTitle(title)
    .task { await model.lists.open(item) }
    .toolbar {
      ToolbarItem {
        Button("Refresh", systemImage: "arrow.clockwise") {
          Task { await model.lists.refresh(item) }
        }
      }
    }
  }

  private var isView: Bool {
    if case .view = item { return true }
    return false
  }

  private var title: String {
    switch item {
    case .all: "All"
    case .repository(let address): address.name
    case .view(let id): model.view(id: id)?.name ?? "View"
    }
  }
}

/// One issue of a list.
struct IssueRow: View {
  var issue: Issue
  var showsRepository: Bool

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      IssueStateIcon(state: issue.state)
      VStack(alignment: .leading, spacing: 4) {
        Text(issue.title).lineLimit(2)
        HStack(spacing: 6) {
          Text(showsRepository ? issue.qualifiedReference : "#\(issue.number)")
            .monospacedDigit()
            .foregroundStyle(.secondary)
          ForEach(issue.labels) { LabelChip(label: $0, size: .small) }
        }
        .font(.caption)
      }
    }
    .padding(.vertical, 2)
  }
}
