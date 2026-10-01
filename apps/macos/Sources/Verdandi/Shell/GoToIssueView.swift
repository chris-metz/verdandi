import SwiftUI
import VerdandiCore

/// The sheet that goes to an issue by its reference.
struct GoToIssueView: View {
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack {
      Text("Go to Issue")
      Button("Close") { dismiss() }
    }
    .padding(40)
  }
}
