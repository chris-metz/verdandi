import Foundation

/// The sidebar entry chosen last and its label filter, which the app keeps
/// on this Mac, never in settings.json, to open on again at the next launch.
public struct LastEntry: Equatable, Sendable {
  public var item: SidebarItem
  public var labelFilter: [Label]

  public init(item: SidebarItem = .all, labelFilter: [Label] = []) {
    self.item = item
    self.labelFilter = labelFilter
  }

  /// Reads what was kept, and finds its entry among those `settings` lists
  /// now. An entry gone since, or nothing readable kept, opens All, without
  /// a label filter.
  public init(kept data: Data?, in settings: Settings) {
    guard let data, let kept = try? JSONDecoder().decode(Kept.self, from: data),
      let item = kept.item(in: settings)
    else {
      self.init()
      return
    }
    self.init(item: item, labelFilter: kept.labels)
  }

  /// What to keep of it.
  public func kept(in settings: Settings) -> Data {
    let kept: Kept =
      switch item {
      case .all: Kept(kind: .all, labels: labelFilter)
      case .repository(let address):
        Kept(
          kind: .repository, repository: address,
          githubId: settings.repositories.first { $0.address == address }?.githubId, labels: labelFilter)
      case .view(let id): Kept(kind: .view, id: id, labels: labelFilter)
      }
    return (try? JSONEncoder().encode(kept)) ?? Data()
  }
}

/// A last entry as it is kept.
private struct Kept: Codable {
  enum Kind: String, Codable {
    case all, repository, view
  }

  var kind: Kind
  /// A view's ID.
  var id: String?
  /// A tracked repository, found by GitHub's ID once known, which survives
  /// a rename, and until then by its address.
  var repository: RepositoryAddress?
  var githubId: Int?
  var labels: [Label]

  func item(in settings: Settings) -> SidebarItem? {
    switch kind {
    case .all:
      return .all
    case .repository:
      let tracked = settings.repositories.first { repository in
        if let githubId { return repository.githubId == githubId }
        return repository.address == self.repository
      }
      return tracked.map { .repository($0.address) }
    case .view:
      guard let id, settings.views.contains(where: { $0.id == id }) else { return nil }
      return .view(id: id)
    }
  }
}
