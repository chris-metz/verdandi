import SwiftUI
import VerdandiCore

/// What the window shows until Verdandi can reach GitHub through gh.
struct SetupView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    VStack(spacing: 16) {
      switch model.setup {
      case .checking, .ready:
        ProgressView("Looking for GitHub CLI…")
      case .ghMissing:
        ContentUnavailableView(
          "GitHub CLI Not Found", systemImage: "terminal",
          description: Text("Verdandi reads GitHub through gh. Install it, e.g. with `brew install gh`."))
      case .signedOut:
        ContentUnavailableView(
          "Not Signed In", systemImage: "person.crop.circle.badge.questionmark",
          description: Text("Run `gh auth login` in a terminal, then check again."))
      case .rejected(_, let message), .failed(let message):
        ContentUnavailableView("Cannot Reach GitHub", systemImage: "wifi.exclamationmark", description: Text(message))
      }
      if model.setup != .checking {
        Button("Check Again") { Task { await model.checkSetup() } }
          .buttonStyle(.glassProminent)
      }
    }
    .padding(40)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
