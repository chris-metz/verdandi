import AppKit
import SwiftUI
import VerdandiCore

/// Settings › GitHub: the account GitHub is read as, the gh in use, and
/// where settings.json is.
struct GitHubSettingsView: View {
  @Environment(AppModel.self) private var model
  /// The gh the user chose, as `AppModel` keeps it; `nil` while gh is
  /// found by itself.
  @AppStorage("ghPath") private var chosenPath: String?
  @State private var rejectedChoice: UnusableGh?
  @State private var choosing = false

  var body: some View {
    Form {
      Section("Account") {
        AccountRow()
      }

      Section {
        LabeledContent("Location") {
          if let gh = model.gh {
            HStack(spacing: 6) {
              Text(gh.url.path.abbreviatingHome)
                .font(.callout.monospaced())
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
                .help(gh.url.path)
                .frame(maxWidth: 300, alignment: .trailing)
              Button("Show in Finder", systemImage: "arrow.forward.circle.fill") {
                NSWorkspace.shared.activateFileViewerSelecting([gh.url])
              }
              .labelStyle(.iconOnly)
              .buttonStyle(.borderless)
              .foregroundStyle(.secondary)
              .help("Show in Finder")
            }
          } else {
            Text(model.setup == .checking ? "Looking…" : "Not found").foregroundStyle(.secondary)
          }
        }
        LabeledContent("Version", value: model.gh?.version ?? "—")
        LabeledContent("Found", value: chosenPath == nil ? "Automatically" : "Chosen by you")
        if let rejectedChoice {
          ChoiceProblem(problem: rejectedChoice)
        }
      } header: {
        Text("GitHub CLI")
      } footer: {
        HStack {
          Spacer()
          Button("Use Automatic") {
            rejectedChoice = nil
            chosenPath = nil
            Task { await model.checkSetup() }
          }
          .disabled(chosenPath == nil || choosing)
          Button("Choose…") {
            Task {
              choosing = true
              rejectedChoice = await chooseGhExecutable(for: model)
              choosing = false
            }
          }
          .disabled(choosing)
        }
      }

      Section("Files") {
        LabeledContent {
          Button("Show in Finder") { showSettingsFile() }
        } label: {
          Text("settings.json")
          Text(Directories.settingsFile.path.abbreviatingHome)
            .lineLimit(1)
            .truncationMode(.middle)
            .help(Directories.settingsFile.path)
        }
      }
    }
    .formStyle(.grouped)
    .scrollDisabled(true)
    .fixedSize(horizontal: false, vertical: true)
    .animation(.smooth, value: rejectedChoice)
  }
}

/// The account gh is signed in as, or why there is none, with Check Again.
private struct AccountRow: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    HStack(spacing: 12) {
      switch model.setup {
      case .ready(let login):
        AvatarView(actor: Actor(login: login, avatarURL: URL(string: "https://github.com/\(login).png?size=96")), size: 40)
        VStack(alignment: .leading, spacing: 2) {
          Text("@\(login)").font(.headline)
          Text("Signed in to github.com with GitHub CLI").font(.caption).foregroundStyle(.secondary)
        }
      case .checking:
        ProgressView().controlSize(.small).frame(width: 40, height: 40)
        Text("Checking…").foregroundStyle(.secondary)
      default:
        if let guidance = SetupGuidance(model.setup) {
          Image(systemName: guidance.symbol)
            .font(.title)
            .symbolRenderingMode(.hierarchical)
            .foregroundStyle(guidance.tint)
            .frame(width: 40, height: 40)
          VStack(alignment: .leading, spacing: 2) {
            Text(guidance.title).font(.headline)
            Text(guidance.commands.first.map { "Run “\($0.command)” in Terminal." } ?? "See the main window.")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
      }
      Spacer()
      Button("Check Again") { Task { await model.checkSetup() } }
        .disabled(model.setup == .checking)
    }
  }
}

/// Shows settings.json in the Finder, or the nearest folder there is while
/// it has not been written yet.
func showSettingsFile() {
  var url = Directories.settingsFile
  while !FileManager.default.fileExists(atPath: url.path), url.pathComponents.count > 1 {
    url.deleteLastPathComponent()
  }
  NSWorkspace.shared.activateFileViewerSelecting([url])
}
