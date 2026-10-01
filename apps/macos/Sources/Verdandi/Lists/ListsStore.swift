import Foundation
import Observation
import VerdandiCore

/// Whether a list has loaded.
enum LoadPhase: Equatable {
  case idle
  case loading
  case loaded(Date)
  case failed(GitHubError)
}

/// The list of one sidebar entry: its matches, as far as they have loaded.
@Observable
final class IssueListModel {
  let item: SidebarItem
  var state: IssueState = .open
  var phase: LoadPhase = .idle
  /// The matches, newest first.
  var matchIDs: [String] = []

  init(item: SidebarItem) {
    self.item = item
  }
}

/// The lists of the sidebar entries, each loaded when first opened.
@Observable
final class ListsStore {
  @ObservationIgnored unowned let model: AppModel
  private(set) var lists: [SidebarItem: IssueListModel] = [:]

  init(model: AppModel) {
    self.model = model
  }

  /// The list of a sidebar entry, made the first time it is asked for.
  func list(for item: SidebarItem) -> IssueListModel {
    if let list = lists[item] { return list }
    let list = IssueListModel(item: item)
    lists[item] = list
    return list
  }

  /// Loads a list unless it has loaded or is loading.
  func open(_ item: SidebarItem) async {
    let list = list(for: item)
    if list.phase == .idle { await load(list) }
  }

  func refresh(_ item: SidebarItem) async {
    await load(list(for: item))
  }

  private func load(_ list: IssueListModel) async {
    guard let client = model.client else { return }
    list.phase = .loading
    do {
      switch list.item {
      case .all:
        var ids: [String] = []
        for repository in model.settings.repositories {
          ids += try await loadRepository(repository.address, state: list.state, client: client)
        }
        list.matchIDs = sortedNewestFirst(ids)
      case .repository(let address):
        list.matchIDs = sortedNewestFirst(try await loadRepository(address, state: list.state, client: client))
      case .view(let id):
        guard let view = model.view(id: id) else { return }
        let page = try await client.searchIssues(view.query, page: 1)
        model.issues.store(page.issues)
        list.matchIDs = page.issues.map(\.id)
      }
      list.phase = .loaded(.now)
    } catch {
      list.phase = .failed(error)
    }
  }

  private func loadRepository(
    _ repository: RepositoryAddress, state: IssueState, client: GitHubClient
  ) async throws(GitHubError) -> [String] {
    var ids: [String] = []
    var after: String?
    repeat {
      let page = try await client.issues(in: repository, state: state, after: after)
      model.issues.store(page.issues)
      ids += page.issues.map(\.id)
      after = page.nextPage
    } while after != nil
    return ids
  }

  private func sortedNewestFirst(_ ids: [String]) -> [String] {
    ids.sorted { (model.issues[$0]?.createdAt ?? .distantPast) > (model.issues[$1]?.createdAt ?? .distantPast) }
  }
}
