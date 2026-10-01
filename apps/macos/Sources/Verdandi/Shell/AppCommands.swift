import SwiftUI
import VerdandiCore

/// The menu bar's own commands. Those that need GitHub are disabled until
/// gh works.
struct AppCommands: Commands {
  var model: AppModel

  static let repository = URL(string: "https://github.com/chris-metz/verdandi")

  var body: some Commands {
    CommandGroup(replacing: .appInfo) {
      AboutCommand()
    }

    CommandGroup(replacing: .newItem) {
      ReadyButton(model: model, title: "New View…") { model.sheet = .viewEditor(nil) }
        .keyboardShortcut("n")
      ReadyButton(model: model, title: "Add Repository…") { model.sheet = .repositoryPicker }
        .keyboardShortcut("a", modifiers: [.command, .shift])
      Divider()
      Button("Show Settings File in Finder") { showSettingsFile() }
    }

    CommandGroup(before: .sidebar) {
      ReadyButton(model: model, title: "Refresh") { Task { await model.refreshShown() } }
        .keyboardShortcut("r")
      Divider()
      StateCommands(model: model)
      Divider()
    }
    SidebarCommands()

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

/// A menu item that works only once gh does. A view of its own, so the
/// menu follows the model as it changes.
private struct ReadyButton: View {
  var model: AppModel
  var title: String
  var action: () -> Void

  var body: some View {
    Button(title, action: action)
      .disabled(model.login == nil)
  }
}

/// Show Open and Show Closed, for a tracked repository's list or All's: a
/// view's state comes from its search text.
private struct StateCommands: View {
  var model: AppModel

  var body: some View {
    let item = model.selection.flatMap { $0 == .all || $0.isRepository ? $0 : nil }
    let list = model.login == nil ? nil : item.map(model.lists.list(for:))
    ForEach(IssueState.allCases, id: \.self) { state in
      Toggle(
        state == .open ? "Show Open" : "Show Closed",
        isOn: Binding(
          get: { list?.state == state },
          set: { isOn in
            guard isOn, let list, list.state != state else { return }
            list.setState(state)
          })
      )
      .disabled(list == nil)
    }
  }
}

extension SidebarItem {
  fileprivate var isRepository: Bool {
    if case .repository = self { return true }
    return false
  }
}

/// About Verdandi, which opens the About window.
private struct AboutCommand: View {
  @Environment(\.openWindow) private var openWindow

  var body: some View {
    Button("About Verdandi") { openWindow(id: AboutView.windowID) }
  }
}
