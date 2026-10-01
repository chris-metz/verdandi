import Foundation
import VerdandiCore

/// The sidebar entry chosen last, kept in UserDefaults on this Mac.
extension LastEntry {
  /// The key it is kept under. It names entries of one settings.json, so a
  /// profile under `VERDANDI_HOME` keeps its own.
  static let key = Directories.home.map { "lastEntry:\($0.path)" } ?? "lastEntry"

  /// What was kept, found among the entries `settings` lists now.
  static func load(in settings: Settings) -> LastEntry {
    LastEntry(kept: UserDefaults.standard.data(forKey: key), in: settings)
  }

  func save(in settings: Settings) {
    UserDefaults.standard.set(kept(in: settings), forKey: Self.key)
  }
}
