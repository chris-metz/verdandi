import SwiftUI
import VerdandiKit

/// A view's name and search, new or edited. (A placeholder, to be built.)
struct ViewEditorView: View {
    let editing: SavedView?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Text(editing == nil ? "New View" : "Edit View").toolbar { Button("Done") { dismiss() } }
        }
    }
}
