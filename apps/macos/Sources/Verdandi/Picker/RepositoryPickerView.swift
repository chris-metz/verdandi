import SwiftUI
import VerdandiCore

/// The sheet that adds tracked repositories.
struct RepositoryPickerView: View {
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack {
      Text("Add Repositories")
      Button("Close") { dismiss() }
    }
    .padding(40)
  }
}
