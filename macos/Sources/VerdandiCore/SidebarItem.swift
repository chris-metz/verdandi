import Foundation

/// One of the places the sidebar opens: All, a tracked repository, or a view.
public enum SidebarItem: Hashable, Sendable, Codable {
  case all
  case repository(RepositoryAddress)
  case view(id: String)
}
