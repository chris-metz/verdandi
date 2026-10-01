import SwiftUI
import VerdandiCore

/// The sheet that creates or edits a view.
struct ViewEditorView: View {
  @Environment(\.dismiss) private var dismiss
  var view: SavedView?
  var duplicate: Bool

  var body: some View {
    VStack {
      Text(view == nil ? "New View" : "Edit View")
      Button("Close") { dismiss() }
    }
    .padding(40)
  }
}
