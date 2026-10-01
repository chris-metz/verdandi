import AppKit
import SwiftUI
import VerdandiCore

/// The foot of the sidebar: why settings.json cannot be read, while it
/// cannot, and the account GitHub is read as.
struct SidebarFooter: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if let problem = model.settingsProblem {
        SettingsProblemView(problem: problem)
          .transition(.move(edge: .bottom).combined(with: .opacity))
      }
      if let login = model.login {
        AccountRow(login: login)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
    .animation(.smooth, value: model.settingsProblem)
  }
}

/// The account GitHub is read as: its avatar and login, quietly.
private struct AccountRow: View {
  var login: String

  var body: some View {
    HStack(spacing: 7) {
      AvatarView(actor: Actor(login: login, avatarURL: URL(string: "https://github.com/\(login).png?size=64")), size: 18)
      Text("@\(login)")
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
    .padding(.leading, 4)
    .help("GitHub is read as @\(login), through gh.")
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Signed in as \(login)")
  }
}

/// Why settings.json cannot be read. The sidebar keeps showing what it
/// last read, and changes nothing until the file can be read again.
private struct SettingsProblemView: View {
  @Environment(AppModel.self) private var model
  var problem: String

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Label("Settings Can’t Be Read", systemImage: "exclamationmark.triangle.fill")
        .font(.callout.weight(.semibold))
        .symbolRenderingMode(.multicolor)
      Text(problem)
        .font(.caption)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
        .textSelection(.enabled)
      Text("The sidebar changes nothing until the file is fixed.")
        .font(.caption)
        .foregroundStyle(.secondary)
      HStack(spacing: 8) {
        Button("Show in Finder") {
          NSWorkspace.shared.activateFileViewerSelecting([model.settingsFile.url])
        }
        Button("Try Again") { model.sidebar.reloadSettings() }
      }
      .controlSize(.small)
      .padding(.top, 2)
    }
    .padding(10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(.orange.opacity(0.12), in: .rect(cornerRadius: 10, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(.orange.opacity(0.3), lineWidth: 0.5)
    }
  }
}
