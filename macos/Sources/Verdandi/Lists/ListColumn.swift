import SwiftUI
import VerdandiCore

/// The selected sidebar entry's list, below any issue pages opened from it.
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
