import Foundation

/// How a tracked repository relates to what GitHub found at its address.
public enum TrackedIdentity: Sendable, Hashable {
  /// The same repository at the same address, its ID stored.
  case unchanged
  /// The same repository, renamed or transferred to `address`, or seen
  /// for the first time since its ID was stored.
  case identified(TrackedRepository)
  /// Another repository took over its address: GitHub's ID is not the one
  /// stored. The tracked repository is elsewhere, or gone.
  case takenOver(by: Int)
}

extension TrackedRepository {
  /// What GitHub's summary of this repository's address says of it. GitHub
  /// follows renames and transfers, and answers with where the repository
  /// is now, and its ID. A change of case alone is a rename too.
  public func identity(from summary: RepositorySummary) -> TrackedIdentity {
    if let githubId, githubId != summary.id { return .takenOver(by: summary.id) }
    if githubId == summary.id, address.description == summary.repository.description { return .unchanged }
    return .identified(TrackedRepository(address: summary.repository, githubId: summary.id))
  }
}

extension Settings {
  /// Stores where tracked repositories are now, by the address
  /// settings.json held: their new addresses and their IDs. Afterwards each
  /// repository is listed once.
  public mutating func identify(_ found: [RepositoryAddress: TrackedRepository]) {
    repositories = repositories.map { entry in
      guard let current = found[entry.address],
        entry.githubId == nil || entry.githubId == current.githubId
      else { return entry }
      return current
    }
    removeDuplicates()
  }

  /// Adds repositories at the end of the sidebar, each unless it is tracked
  /// already: by its ID, or by its address while the entry has no ID, which
  /// then takes the new one's address and ID. Says which were added.
  @discardableResult
  public mutating func track(_ added: [TrackedRepository]) -> [TrackedRepository] {
    var appended: [TrackedRepository] = []
    for repository in added {
      if let index = repositories.firstIndex(where: { $0.isSame(as: repository) }) {
        if repository.githubId != nil { repositories[index] = repository }
        continue
      }
      repositories.append(repository)
      appended.append(repository)
    }
    removeDuplicates()
    return appended
  }

  /// Removes a tracked repository, under any case of its address.
  public mutating func untrack(_ address: RepositoryAddress) {
    repositories.removeAll { $0.address == address }
  }

  /// Saves a view: in its place when one with its ID is listed, otherwise
  /// right after the view `after`, or else at the end.
  public mutating func save(_ view: SavedView, after: String? = nil) {
    if let index = views.firstIndex(where: { $0.id == view.id }) {
      views[index] = view
    } else if let after, let index = views.firstIndex(where: { $0.id == after }) {
      views.insert(view, at: index + 1)
    } else {
      views.append(view)
    }
  }

  public mutating func removeView(id: String) {
    views.removeAll { $0.id == id }
  }

  /// Lists each repository once, as the first entry with its ID or its
  /// address, and each view once, as the first with its ID.
  public mutating func removeDuplicates() {
    var ids: Set<Int> = []
    var addresses: Set<RepositoryAddress> = []
    repositories = repositories.filter { entry in
      if let id = entry.githubId, !ids.insert(id).inserted { return false }
      return addresses.insert(entry.address).inserted
    }
    var viewIds: Set<String> = []
    views = views.filter { viewIds.insert($0.id).inserted }
  }
}

extension TrackedRepository {
  /// Whether two entries are the same repository: by ID when both know it,
  /// otherwise by address.
  public func isSame(as other: TrackedRepository) -> Bool {
    if let id = githubId, let otherId = other.githubId { return id == otherId }
    return address == other.address
  }
}

extension SavedView {
  /// A new view with this one's search, named as its copy.
  public var duplicate: SavedView {
    SavedView(name: "\(name) Copy", query: query)
  }
}
