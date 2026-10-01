import AppKit
import SwiftUI
import VerdandiCore

/// Launch options read from the environment, for screenshots and for
/// trying a state without clicking to it:
///
/// - `VERDANDI_APPEARANCE`: `light` or `dark`
/// - `VERDANDI_SELECT`: `all`, `repo:owner/name` or `view:<id>`
/// - `VERDANDI_ISSUE`: `owner/name#12`, the issue the detail column shows
/// - `VERDANDI_SHEET`: `repository-picker`, `new-view` or `go-to-issue`
/// - `VERDANDI_WINDOW_SIZE`: e.g. `1440x900`
/// - `VERDANDI_WINDOW_FILE`: where to write the window's number once it
///   shows, for `screencapture -l`
/// - `VERDANDI_ACTIVATE=1`: bring the window to the front, so it shows as
///   the active window does
enum LaunchOptions {
  static let environment = ProcessInfo.processInfo.environment

  static var appearance: NSAppearance? {
    switch environment["VERDANDI_APPEARANCE"] {
    case "light": NSAppearance(named: .aqua)
    case "dark": NSAppearance(named: .darkAqua)
    default: nil
    }
  }

  static var selection: SidebarItem? {
    guard let value = environment["VERDANDI_SELECT"] else { return nil }
    if value == "all" { return .all }
    if value.hasPrefix("repo:"), let address = RepositoryAddress(String(value.dropFirst(5))) {
      return .repository(address)
    }
    if value.hasPrefix("view:") { return .view(id: String(value.dropFirst(5))) }
    return nil
  }

  /// The issue to show, as `owner/name` and number.
  static var issue: (RepositoryAddress, Int)? {
    guard let value = environment["VERDANDI_ISSUE"],
      let match = value.firstMatch(of: /^([^#]+)#(\d+)$/),
      let address = RepositoryAddress(String(match.1)), let number = Int(match.2)
    else { return nil }
    return (address, number)
  }

  static var sheet: AppSheet? {
    switch environment["VERDANDI_SHEET"] {
    case "repository-picker": .repositoryPicker
    case "new-view": .viewEditor(nil)
    case "go-to-issue": .goToIssue
    default: nil
    }
  }

  static var windowSize: CGSize? {
    guard let value = environment["VERDANDI_WINDOW_SIZE"],
      let match = value.firstMatch(of: /^(\d+)x(\d+)$/)
    else { return nil }
    return CGSize(width: Int(match.1)!, height: Int(match.2)!)
  }

  static var windowFile: URL? {
    environment["VERDANDI_WINDOW_FILE"].map(URL.init(fileURLWithPath:))
  }

  /// Applies the options that need the model, once gh works.
  static func apply(to model: AppModel) async {
    if let selection { model.selection = selection }
    if let sheet { model.sheet = sheet }
    if let (address, number) = issue, let client = model.client,
      case .issue(let reference, _) = try? await client.item(numbered: number, in: address)
    {
      model.openIssue(reference.id)
    }
  }
}

/// Writes the window's number to `VERDANDI_WINDOW_FILE` once it shows, and
/// sizes it as `VERDANDI_WINDOW_SIZE` says.
struct WindowNumberReporter: NSViewRepresentable {
  func makeNSView(context: Context) -> NSView { ReportingView() }
  func updateNSView(_ view: NSView, context: Context) {}

  final class ReportingView: NSView {
    override func viewDidMoveToWindow() {
      super.viewDidMoveToWindow()
      guard let window else { return }
      if let size = LaunchOptions.windowSize {
        window.setContentSize(size)
        window.center()
      }
      if LaunchOptions.environment["VERDANDI_ACTIVATE"] == "1" {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
          NSApp.activate(ignoringOtherApps: true)
          window.makeKeyAndOrderFront(nil)
          window.orderFrontRegardless()
        }
      }
      if let file = LaunchOptions.windowFile {
        try? String(window.windowNumber).write(to: file, atomically: true, encoding: .utf8)
      }
    }
  }
}
