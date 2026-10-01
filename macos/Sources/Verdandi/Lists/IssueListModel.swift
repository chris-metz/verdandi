import Foundation
import Observation
import VerdandiCore

/// One run of a view's search: what it returned, in its order.
struct SearchRun: Equatable {
  let id = UUID()
  /// The search text it ran.
  var query: String
  var returned: [Issue]
  /// How many issues and pull requests GitHub counts as matches.
  var total: Int
  var pullRequests: Int
  /// Whether GitHub says it did not search everything in time.
  var incomplete: Bool
  var finishedAt: Date?

  /// Whether the search returned all it matches: no more than GitHub's
  /// ceiling of 1,000, and in time.
  var isComplete: Bool {
    finishedAt != nil && !incomplete && returned.count + pullRequests >= total
  }
}

/// A part of a list that could not be read, as its status line names it.
struct ListProblem: Hashable {
  /// What could not be read, e.g. `cli/cli`, or "The search".
  var subject: String
  var error: GitHubError
}

/// The list of one sidebar entry: its state, label filter and expansion,
/// and its forest over the issue store, so that every new read shows.
@Observable
final class IssueListModel {
  let item: SidebarItem
  @ObservationIgnored unowned let lists: ListsStore

  /// The state it shows, in All and a repository's list; a view's comes
  /// from its search.
  private(set) var state: IssueState = .open
  /// The labels its matches carry every one of. The selected entry's is
  /// kept for the next launch.
  private(set) var labelFilter: [VerdandiCore.Label] = [] {
    didSet {
      if item == model.selection { model.keepLastEntry() }
    }
  }
  private(set) var expansion = Expansion()

  // A view's search.
  private(set) var run: SearchRun?
  /// The page the search reads, and how many it will read once known.
  private(set) var searching: (page: Int, pages: Int?)?
  private(set) var searchProblem: GitHubError?
  /// The issues read by node ID since the search ran.
  private(set) var readSinceSearch: Set<String> = []
  @ObservationIgnored private var searchTask: Task<Void, Never>?

  /// How many reads of issues by node ID are under way.
  private(set) var pendingReads = 0
  /// Issues asked for by node ID, so that none is asked for twice until
  /// the list is refreshed.
  @ObservationIgnored private var requested: Set<String> = []

  init(item: SidebarItem, lists: ListsStore) {
    self.item = item
    self.lists = lists
    applyLaunchState()
  }

  private var model: AppModel { lists.model }

  var isView: Bool {
    if case .view = item { return true }
    return false
  }

  /// The saved view it shows, if it is a view's list.
  var view: SavedView? {
    if case .view(let id) = item { return model.view(id: id) }
    return nil
  }

  // MARK: What it shows

  /// The repositories whose issues it lists: every tracked one in All.
  var repositories: [RepositoryAddress] {
    switch item {
    case .all: model.settings.repositories.map(\.address)
    case .repository(let address): [address]
    case .view: []
    }
  }

  /// The repositories' issues in its state.
  var loads: [RepositoryIssues] {
    repositories.map { lists.issues(of: $0, state: state) }
  }

  var tracked: Set<RepositoryAddress> {
    Set(model.settings.repositories.map(\.address))
  }

  /// Its issues arranged into their sub-issue forest, from the issues read
  /// so far.
  var forest: Forest {
    let store = model.issues
    switch item {
    case .all, .repository:
      let scope: ListScope =
        if case .repository(let address) = item { .repository(address) } else { .all }
      return Forest.list(
        scope: scope, state: state, scopeIDs: loads.flatMap(\.ids), labelFilter: labelFilter,
        issues: store.issues, failures: store.failures, tracked: tracked, expansion: expansion)
    case .view:
      guard let run else { return .empty }
      return Forest.view(
        returned: run.returned, labelFilter: labelFilter, complete: run.isComplete, issues: store.issues,
        failures: store.failures, readSinceSearch: readSinceSearch, tracked: tracked, expansion: expansion)
    }
  }

  /// Whether it has something to show, or has read that there is nothing.
  var hasLoaded: Bool {
    isView ? run != nil : loads.contains { $0.hasLoaded || !$0.ids.isEmpty }
  }

  /// Whether a read of its issues or of their search is under way.
  var isLoading: Bool {
    isView ? searching != nil : loads.contains(where: \.isLoading)
  }

  /// Whether anything at all is being read for it.
  var isBusy: Bool { isLoading || pendingReads > 0 }

  /// When what it shows was read, the oldest part if parts differ.
  var updatedAt: Date? {
    if isView { return run?.finishedAt }
    let times = loads.map(\.updatedAt)
    return times.contains(nil) ? nil : times.compactMap(\.self).min()
  }

  /// How many pages have been read, and how many there are once known.
  var pageProgress: (loaded: Int, total: Int?) {
    if isView { return (searching?.page ?? 0, searching?.pages) }
    let reading = loads.filter(\.isLoading)
    let counts = reading.map(\.pageCount)
    let total = counts.contains(nil) ? nil : counts.compactMap(\.self).reduce(0, +)
    return (reading.map(\.pagesLoaded).reduce(0, +), total)
  }

  /// What of it could not be read.
  var problems: [ListProblem] {
    if isView { return searchProblem.map { [ListProblem(subject: "The search", error: $0)] } ?? [] }
    return loads.compactMap { load in
      load.problem.map { ListProblem(subject: load.repository.description, error: $0) }
    }
  }

  /// Why nothing shows, if nothing could be read at all.
  var failure: GitHubError? {
    guard !hasLoaded, !isLoading else { return nil }
    return problems.first?.error
  }

  // MARK: Loading

  /// Loads what has not loaded, unless it is loading; what failed is read
  /// again as the list opens again.
  func load() async {
    guard let client = model.client else { return }
    if isView {
      if run == nil || run?.query != view?.query || searchProblem != nil { await search(client: client) }
    } else {
      await read(loads.filter { !$0.hasLoaded || $0.problem != nil }, client: client)
    }
  }

  /// Reads it again: its issues, or its search, and then the other issues
  /// it shows, so that their relationships are as new.
  func refresh() async {
    guard let client = model.client else { return }
    let shownBefore = forest.allNodes.filter { $0.issue != nil }
    let scope: Set<String>
    if isView {
      // The search's matches are read again as the new run shows.
      await search(client: client)
      scope = Set(run?.returned.map(\.id) ?? [])
    } else {
      await read(loads, client: client)
      requested = []
      scope = Set(loads.flatMap(\.ids))
    }
    let others = shownBefore.filter { !scope.contains($0.id) }.map(\.id)
    if !others.isEmpty { await reread(others, client: client) }
  }

  /// Reads again what could not be read: repositories, the search, issues.
  func retry() async {
    guard let client = model.client else { return }
    if isView {
      if searchProblem != nil {
        await search(client: client)
        return
      }
    } else {
      await read(loads.filter { $0.problem != nil || !$0.hasLoaded }, client: client)
    }
    let forest = forest
    let failedParents = forest.trees.compactMap(\.parent).filter { $0.unread?.isFailure == true }
    let failed = forest.allNodes.filter { $0.unread?.isFailure == true }.map(\.id) + failedParents.map(\.reference.id)
    if !failed.isEmpty { await reread(failed, client: client) }
  }

  private func read(_ loads: [RepositoryIssues], client: GitHubClient) async {
    let store = model.issues
    let tasks = loads.map { load in Task { await load.load(client: client, into: store) } }
    for task in tasks { await task.value }
  }

  private func reread(_ ids: [String], client: GitHubClient) async {
    pendingReads += 1
    await model.issues.fetch(ids, with: client, again: true)
    pendingReads -= 1
  }

  /// Runs the view's search, up to GitHub's ceiling of 1,000 matches, 100
  /// at a time. The first run shows each page as it comes.
  private func search(client: GitHubClient) async {
    guard let view else { return }
    if let searchTask {
      await searchTask.value
      return
    }
    let task = Task { await runSearch(view.query, client: client) }
    searchTask = task
    await task.value
    searchTask = nil
  }

  private func runSearch(_ query: String, client: GitHubClient) async {
    let first = run == nil
    searching = (1, nil)
    searchProblem = nil
    var found = SearchRun(query: query, returned: [], total: 0, pullRequests: 0, incomplete: false)
    do {
      var page = 1
      while true {
        let answer = try await client.searchIssues(query, page: page)
        found.returned += answer.issues
        found.total = answer.total
        found.pullRequests += answer.pullRequests
        found.incomplete = found.incomplete || answer.incomplete
        let pages = min(10, max(1, (answer.total + 99) / 100))
        searching = (page, pages)
        if first { show(found) }
        if page >= pages || answer.issues.count + answer.pullRequests < 100 { break }
        page += 1
      }
      found.finishedAt = .now
      show(found)
    } catch {
      searchProblem = error
    }
    searching = nil
  }

  /// Shows a run of the search; its matches are read again for their
  /// relationships, which a search does not name.
  private func show(_ found: SearchRun) {
    if run?.id != found.id {
      readSinceSearch = []
      requested = []
    }
    run = found
  }

  /// Reads the issues the forest names but has not read, once the list's
  /// own issues have loaded. A view reads its matches again too.
  func readMissing(_ ids: [String]) {
    guard let client = model.client else { return }
    let wanted = ids.filter { requested.insert($0).inserted }
    guard !wanted.isEmpty else { return }
    pendingReads += 1
    let runID = run?.id
    Task {
      await model.issues.fetch(wanted, with: client, again: isView)
      if isView, run?.id == runID { readSinceSearch.formUnion(wanted) }
      pendingReads -= 1
    }
  }

  /// What it loads from: its state and repositories, or its view's search.
  /// The list loads again when they change.
  var loadKey: [String] {
    [state.rawValue, view?.query ?? ""] + repositories.map(\.description)
  }

  /// Whether its own issues have loaded, so that what they name can be read.
  var isSettled: Bool {
    isView ? run != nil && searching == nil : hasLoaded && !isLoading
  }

  // MARK: Changes

  /// Shows the other state; the list's view loads it as it shows.
  func setState(_ state: IssueState) {
    guard !isView, state != self.state else { return }
    self.state = state
  }

  func toggleState() {
    setState(state == .open ? .closed : .open)
  }

  func addLabel(_ label: VerdandiCore.Label) {
    labelFilter = labelFilter.adding(label)
  }

  func addLabels(_ labels: [VerdandiCore.Label]) {
    labelFilter = labels.reduce(labelFilter) { $0.adding($1) }
  }

  func removeLabel(named name: String) {
    labelFilter = labelFilter.removing(named: name)
  }

  func clearLabelFilter() {
    labelFilter = []
  }

  func setExpanded(_ id: String, _ expanded: Bool) {
    expansion.set(id, expanded: expanded)
  }

  func setEverythingExpanded(_ expanded: Bool) {
    expansion.setEverything(expanded: expanded)
  }
}
