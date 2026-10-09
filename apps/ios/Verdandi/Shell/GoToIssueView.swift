import SwiftUI
import VerdandiKit

/// Going to an issue by its number or link, or to a recent issue. (A
/// placeholder, to be built.)
struct GoToIssueView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Text("Go to Issue").toolbar { Button("Done") { dismiss() } }
        }
    }
}
