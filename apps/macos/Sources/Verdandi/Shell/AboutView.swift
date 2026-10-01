import AppKit
import SwiftUI

/// The About window: the icon over a soft backdrop, the version, what
/// Verdandi is for, and where it lives.
struct AboutView: View {
  static let windowID = "about"

  private var version: String {
    let info = Bundle.main.infoDictionary
    let short = info?["CFBundleShortVersionString"] as? String ?? "0.1"
    let build = info?["CFBundleVersion"] as? String
    return build.map { "Version \(short) (\($0))" } ?? "Version \(short)"
  }

  var body: some View {
    VStack(spacing: 0) {
      Image(nsImage: NSApp.applicationIconImage)
        .resizable()
        .interpolation(.high)
        .frame(width: 128, height: 128)
        .shadow(color: .black.opacity(0.2), radius: 14, y: 8)
        .accessibilityHidden(true)
      Text("Verdandi")
        .font(.system(size: 28, weight: .bold))
        .padding(.top, 14)
      Text(version)
        .font(.callout)
        .foregroundStyle(.secondary)
        .textSelection(.enabled)
        .padding(.top, 2)
      Text("GitHub issues across many repositories, with their sub-issues and blocking chains.")
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 16)
      if let repository = AppCommands.repository {
        Link(destination: repository) {
          Label("Verdandi on GitHub", systemImage: "arrow.up.forward.square")
        }
        .buttonStyle(.glass)
        .controlSize(.large)
        .padding(.top, 20)
      }
      Text("A native SwiftUI experiment · Reads GitHub through gh\n© 2026 Chris Metz")
        .font(.caption)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .padding(.top, 20)
    }
    .padding(.horizontal, 36)
    .padding(.top, 36)
    .padding(.bottom, 28)
    .frame(width: 360)
    .background { SetupBackdrop().opacity(0.85).ignoresSafeArea() }
    .windowMinimizeBehavior(.disabled)
    .background(WindowNumberReporter(role: "about"))
  }
}
