import SwiftUI
import VerdandiKit

/// Adding tracked repositories: those the account reaches, or any by its
/// `owner/name`. (A placeholder, to be built.)
struct RepositoryPickerView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Text("Add Repository").toolbar { Button("Done") { dismiss() } }
        }
    }
}
