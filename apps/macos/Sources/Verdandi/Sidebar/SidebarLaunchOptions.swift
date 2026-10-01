import Foundation
import VerdandiCore

/// The sidebar's launch options, besides those of `LaunchOptions`, for
/// screenshots of states that take clicks to reach:
///
/// - `VERDANDI_SHEET`: also `edit-view:<id>` or `duplicate-view:<id>`
/// - `VERDANDI_REMOVE`: `repo:owner/name` or `view:<id>`, asks to remove it
/// - `VERDANDI_SHORTCUTS=1`: entries show their ⌘ shortcuts
/// - `VERDANDI_PICKER_SEARCH`: what the repository picker's search starts with
/// - `VERDANDI_VIEW_NAME`, `VERDANDI_VIEW_QUERY`: what a new view starts with
enum SidebarLaunchOptions {
  static var environment: [String: String] { LaunchOptions.environment }

  static func apply(to model: AppModel) {
    if let sheet = environment["VERDANDI_SHEET"] {
      if sheet.hasPrefix("edit-view:") { model.sidebar.edit(String(sheet.dropFirst("edit-view:".count))) }
      if sheet.hasPrefix("duplicate-view:") {
        model.sidebar.duplicate(String(sheet.dropFirst("duplicate-view:".count)))
      }
    }
    if let removal = environment["VERDANDI_REMOVE"] {
      if removal.hasPrefix("repo:"), let address = RepositoryAddress(String(removal.dropFirst(5))) {
        model.sidebar.requestRemoval(.repository(address))
      } else if removal.hasPrefix("view:") {
        model.sidebar.requestRemoval(.view(id: String(removal.dropFirst(5))))
      }
    }
  }

  static var pickerSearch: String { environment["VERDANDI_PICKER_SEARCH"] ?? "" }
  static var viewName: String { environment["VERDANDI_VIEW_NAME"] ?? "" }
  static var viewQuery: String { environment["VERDANDI_VIEW_QUERY"] ?? "" }
}
