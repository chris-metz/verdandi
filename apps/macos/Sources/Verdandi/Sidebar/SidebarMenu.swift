import AppKit
import SwiftUI
import VerdandiCore

/// The context menu of the sidebar's entries, or of the sidebar itself when
/// no entry was clicked.
struct SidebarMenu: View {
  @Environment(AppModel.self) private var model
  @Environment(\.openURL) private var openURL
  var items: Set<SidebarItem>

  var body: some View {
    let sidebar = model.sidebar
    if items.count == 1, let item = items.first {
      switch item {
      case .all:
        Button("Refresh Counts", systemImage: "arrow.clockwise") {
          Task { await sidebar.refreshSummaries() }
        }
      case .repository(let address):
        Button("Open on GitHub", systemImage: "safari") {
          if let url = URL(string: "https://github.com/\(address)") { openURL(url) }
        }
        Button("Copy Name", systemImage: "doc.on.doc") { copy(address.description) }
        Divider()
        moveButtons(item)
        Divider()
        Button("Remove…", systemImage: "trash", role: .destructive) { sidebar.requestRemoval(item) }
          .disabled(!sidebar.canChange)
      case .view(let id):
        if let view = model.view(id: id) {
          Button("Edit…", systemImage: "pencil") { sidebar.edit(id) }
            .disabled(!sidebar.canChange)
          Button("Duplicate…", systemImage: "plus.square.on.square") { sidebar.duplicate(id) }
            .disabled(!sidebar.canChange)
          Button("Copy Query", systemImage: "doc.on.doc") { copy(view.query) }
          Button("Open on GitHub", systemImage: "safari") {
            if let url = Self.searchURL(view.query) { openURL(url) }
          }
          Divider()
          moveButtons(item)
          Divider()
          Button("Remove…", systemImage: "trash", role: .destructive) { sidebar.requestRemoval(item) }
            .disabled(!sidebar.canChange)
        }
      }
    } else if items.isEmpty {
      Button("Add Repositories…", systemImage: "plus") { sidebar.showRepositoryPicker() }
        .disabled(!sidebar.canChange)
      Button("New View…", systemImage: "line.3.horizontal.decrease.circle") { sidebar.newView() }
        .disabled(!sidebar.canChange)
    }
  }

  @ViewBuilder
  private func moveButtons(_ item: SidebarItem) -> some View {
    let sidebar = model.sidebar
    Button("Move Up", systemImage: "arrow.up") { sidebar.move(item, by: -1) }
      .disabled(!sidebar.canChange)
    Button("Move Down", systemImage: "arrow.down") { sidebar.move(item, by: 1) }
      .disabled(!sidebar.canChange)
  }

  private func copy(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
  }

  /// A search on github.com, as a view's search runs it.
  static func searchURL(_ query: String) -> URL? {
    var components = URLComponents(string: "https://github.com/issues")
    components?.queryItems = [URLQueryItem(name: "q", value: query)]
    return components?.url
  }
}
