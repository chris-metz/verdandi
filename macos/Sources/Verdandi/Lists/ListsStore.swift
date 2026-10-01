import Foundation
import Observation
import VerdandiCore

/// Whether something has loaded.
enum LoadPhase: Equatable {
  case idle
  case loading
  case loaded(Date)
  case failed(GitHubError)
}

/// A tracked repository's issues in one state, as far as they have loaded.
/// All and the repository's own list share them, so that neither reads them
/// again, nor both at once.
@Observable
final class RepositoryIssues {
  let repository: RepositoryAddress
  let state: IssueState
  /// The issues, newest first.
  private(set) var ids: [String] = []
  private(set) var isLoading = false
  /// How many pages of 100 the current read has read.
  private(set) var pagesLoaded = 0
  /// How many issues the repository has in this state, once GitHub said.
  private(set) var total: Int?
  /// When every page was last read.
  private(set) var updatedAt: Date?
  /// Why the last read failed; what was read before stays.
  private(set) var problem: GitHubError?
  @ObservationIgnored private var reading: Task<Void, Never>?

  init(repository: RepositoryAddress, state: IssueState) {
    self.repository = repository
    self.state = state
  }

  var hasLoaded: Bool { updatedAt != nil }

  /// How many pages the read takes, once the total is known.
  var pageCount: Int? {
    total.map { max(1, ($0 + 99) / 100) }
  }

  /// Reads every page, unless a read is under way, which it waits for
  /// instead.
  func load(client: GitHubClient, into store: IssueStore) async {
    if let reading {
      await reading.value
      return
    }
    let task = Task { await read(client: client, into: store) }
    reading = task
    await task.value
    reading = nil
  }

  private func read(client: GitHubClient, into store: IssueStore) async {
    isLoading = true
    problem = nil
    pagesLoaded = 0
    // The first read shows each page as it comes; a later one replaces the
    // list at once, so it does not shrink meanwhile.
    let first = !hasLoaded
    if state == .open { readOpenCount(client: client) }
    var read: [String] = []
    var after: String?
    do {
      repeat {
        let page = try await client.issues(in: repository, state: state, after: after)
        store.store(page.issues)
        read += page.issues.map(\.id)
        if state == .closed { total = page.closedIssueCount }
        pagesLoaded += 1
        if first { ids = read }
        after = page.nextPage
      } while after != nil
      ids = read
      total = read.count
      updatedAt = .now
    } catch {
      problem = error
      if first { ids = read }
    }
    isLoading = false
  }

  /// Asks how many open issues there are, so that loading can say how many
  /// pages it has to go. A page of issues says only how many are closed.
  private func readOpenCount(client: GitHubClient) {
    let repository = repository
    Task {
      guard case .success(let summary)? = try? await client.repositorySummaries([repository]).first,
        isLoading
      else { return }
      total = summary.openIssueCount
    }
  }
}

/// The lists of the sidebar entries, each loaded when first opened, and the
/// repositories' issues they share.
@Observable
final class ListsStore {
  @ObservationIgnored unowned let model: AppModel
  @ObservationIgnored private var lists: [SidebarItem: IssueListModel] = [:]
  @ObservationIgnored private var repositories: [RepositoryKey: RepositoryIssues] = [:]
  /// Whether a list has taken the keyboard yet, which only the first does.
  @ObservationIgnored var hasFocusedAList = false

  init(model: AppModel) {
    self.model = model
  }

  /// The list of a sidebar entry, made the first time it is asked for. It
  /// keeps its state, label filter and expansion until the app quits.
  func list(for item: SidebarItem) -> IssueListModel {
    if let list = lists[item] { return list }
    let list = IssueListModel(item: item, lists: self)
    lists[item] = list
    return list
  }

  /// Gives the list of an entry's new item the label filter of its old one,
  /// as when a tracked repository is renamed.
  func carryLabelFilter(from old: SidebarItem, to new: SidebarItem) {
    guard let filter = lists[old]?.labelFilter else { return }
    list(for: new).addLabels(filter)
  }

  /// A repository's issues in a state, shared by every list that shows them.
  func issues(of repository: RepositoryAddress, state: IssueState) -> RepositoryIssues {
    let key = RepositoryKey(repository: repository, state: state)
    if let issues = repositories[key] { return issues }
    let issues = RepositoryIssues(repository: repository, state: state)
    repositories[key] = issues
    return issues
  }

  /// Loads what a list shows unless it has loaded or is loading.
  func open(_ item: SidebarItem) async {
    await list(for: item).load()
  }

  /// Reads a list again.
  func refresh(_ item: SidebarItem) async {
    await list(for: item).refresh()
  }
}

/// A repository's issues in one state, as a key.
struct RepositoryKey: Hashable {
  var repository: RepositoryAddress
  var state: IssueState
}
