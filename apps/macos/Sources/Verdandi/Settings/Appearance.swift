import AppKit
import SwiftUI

/// Whether Verdandi looks light or dark: as macOS does, or always one of
/// them. It is kept in UserDefaults on this Mac, not in settings.json, and
/// applies to every window at once.
enum Appearance: String, CaseIterable, Identifiable {
  case system
  case light
  case dark

  /// The UserDefaults key it is kept under.
  static let key = "appearance"

  /// The appearance chosen in Settings, or `system` until one is.
  static var chosen: Appearance {
    UserDefaults.standard.string(forKey: key).flatMap(Appearance.init(rawValue:)) ?? .system
  }

  var id: Self { self }

  var title: String {
    switch self {
    case .system: "Automatic"
    case .light: "Light"
    case .dark: "Dark"
    }
  }

  var nsAppearance: NSAppearance? {
    switch self {
    case .system: nil
    case .light: NSAppearance(named: .aqua)
    case .dark: NSAppearance(named: .darkAqua)
    }
  }

  /// Makes every window look so, unless `VERDANDI_APPEARANCE` says otherwise
  /// for a screenshot.
  func apply() {
    NSApp.appearance = LaunchOptions.appearance ?? nsAppearance
  }
}
