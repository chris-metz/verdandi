import SwiftUI
import VerdandiCore

/// The middle column: the selected sidebar entry's list.
struct ListColumn: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    if let item = model.selection {
      IssueListView(item: item)
        .id(item)
    } else {
      ContentUnavailableView("Nothing Selected", systemImage: "sidebar.left")
    }
  }
}
