import AppKit
import SwiftUI
import VerdandiCore

@main
struct VerdandiApp: App {
  @NSApplicationDelegateAdaptor private var delegate: AppDelegate
  @State private var model = AppModel()

  var body: some Scene {
    Window("Verdandi", id: "main") {
      MainWindow()
        .environment(model)
        .frame(minWidth: 900, minHeight: 600)
        .task(id: model.setup) {
          if case .ready = model.setup { await LaunchOptions.apply(to: model) }
        }
    }
    .defaultSize(width: 1280, height: 820)
    .windowResizability(.contentMinSize)
    .windowToolbarStyle(.unified)
    .commands { AppCommands(model: model) }

    Settings {
      SettingsView()
        .environment(model)
    }

    Window("About Verdandi", id: AboutView.windowID) {
      AboutView()
    }
    .windowResizability(.contentSize)
    .windowStyle(.hiddenTitleBar)
    .windowBackgroundDragBehavior(.enabled)
    .restorationBehavior(.disabled)
    .defaultPosition(.center)
    .commandsRemoved()
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    Appearance.chosen.apply()
    // Run straight from the build folder, the binary is no bundle yet.
    NSApp.setActivationPolicy(.regular)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
