import SwiftUI
import VerdandiKit

/// The account, the appearance and the themes. (A placeholder, to be built.)
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Text("Settings").toolbar { Button("Done") { dismiss() } }
        }
    }
}
