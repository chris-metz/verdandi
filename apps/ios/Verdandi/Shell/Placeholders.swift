import SwiftUI
import VerdandiKit

// Screens still to be built: each is replaced by its own file.

struct RepositoryPickerView: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Text("Add Repository").toolbar { Button("Done") { dismiss() } }
        }
    }
}

struct ViewEditorView: View {
    let editing: SavedView?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Text(editing == nil ? "New View" : "Edit View").toolbar { Button("Done") { dismiss() } }
        }
    }
}

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Text("Settings").toolbar { Button("Done") { dismiss() } }
        }
    }
}

struct GoToIssueView: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Text("Go to Issue").toolbar { Button("Done") { dismiss() } }
        }
    }
}
