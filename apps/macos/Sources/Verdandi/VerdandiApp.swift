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
        .frame(minWidth: 900, minHeight: 560)
        .task(id: model.setup) {
          if case .ready = model.setup { await LaunchOptions.apply(to: model) }
        }
    }
    .windowToolbarStyle(.unified)
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    if let appearance = LaunchOptions.appearance { NSApp.appearance = appearance }
    // Run straight from the build folder, the binary is no bundle yet.
    NSApp.setActivationPolicy(.regular)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
