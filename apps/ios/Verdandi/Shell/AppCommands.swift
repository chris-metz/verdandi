import SwiftUI
import VerdandiKit

/// The menu bar's commands and their shortcuts, for an iPad with a
/// keyboard, as the desktop app has them. Those that need GitHub wait until
/// it can be read.
struct AppCommands: Commands {
    var model: AppModel

    static let repository = AboutView.repository

    var body: some Commands {
        CommandGroup(replacing: .appSettings) {
            Button("Settings…") { model.sheet = .settings }
                .keyboardShortcut(",")
        }

        CommandGroup(replacing: .newItem) {
            ReadyButton(model: model, title: "New View…") {
                model.editedView = nil
                model.sheet = .newView
            }
            .keyboardShortcut("n")
            ReadyButton(model: model, title: "Add Repository…") { model.sheet = .repositoryPicker }
                .keyboardShortcut("a", modifiers: [.command, .shift])
        }

        CommandGroup(before: .sidebar) {
            ReadyButton(model: model, title: "Refresh") { Task { await model.refresh() } }
                .keyboardShortcut("r")
            Divider()
        }

        CommandMenu("Go") {
            ReadyButton(model: model, title: "Go to Issue…") { model.sheet = .goToIssue }
                .keyboardShortcut("k")
        }

        CommandGroup(replacing: .help) {
            if let repository = Self.repository {
                Link("Verdandi on GitHub", destination: repository)
                Link("Report an Issue…", destination: repository.appending(path: "issues/new"))
            }
        }
    }
}

/// A command that works only once GitHub can be read. A view of its own,
/// so that the menu follows the model as it changes.
private struct ReadyButton: View {
    var model: AppModel
    var title: String
    var action: () -> Void

    var body: some View {
        Button(title, action: action)
            .disabled(!ready)
    }

    private var ready: Bool {
        guard model.phase == .running, case .ready = model.setup else { return false }
        return true
    }
}
