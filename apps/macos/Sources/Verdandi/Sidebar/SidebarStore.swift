import AppKit
import Foundation
import Observation
import VerdandiCore

/// How many matches a view's search has, as GitHub last said.
enum MatchCount: Equatable {
  case known(Int, incomplete: Bool)
  /// GitHub rejected the search, saying why.
  case rejected(String)
  case failed(GitHubError)
}

/// What the sidebar shows besides the settings: each tracked repository's
/// summary and each view's match count, as GitHub last said. It also
/// changes what the sidebar lists, in settings.json, and keeps the sidebar
/// in step with that file when it changes outside the app.
///
/// The menus call its methods too: `selectEntry(at:)` for ⌘1…⌘9,
/// `showRepositoryPicker()`, `newView()`, `editSelectedView()`,
/// `duplicateSelectedView()`, `removeSelection()`, `moveSelection(by:)` and
/// `refreshSummaries()`, enabled by `canChange`, `canChangeSelection` and
/// `selectedViewID`.
@Observable
final class SidebarStore {
  @ObservationIgnored unowned let model: AppModel
  private(set) var summaries: [RepositoryAddress: RepositorySummary] = [:]
  private(set) var problems: [RepositoryAddress: GitHubError] = [:]
  /// Each view's match count, by its search text, so that renaming a view
  /// does not search again.
  private(set) var matchCounts: [String: MatchCount] = [:]
  /// The entry whose removal waits for the user to confirm it.
  var pendingRemoval: SidebarItem?

  @ObservationIgnored private var asking: Set<RepositoryAddress> = []
  @ObservationIgnored private var counting: Set<String> = []
  @ObservationIgnored private var refreshedAt: Date?
  @ObservationIgnored private var watcher: FileWatcher?

  /// How long counts stay fresh before they are read again on their own.
  static let freshFor: TimeInterval = 5 * 60

  init(model: AppModel) {
    self.model = model
  }

  // MARK: Entries

  /// The tracked repositories as the sidebar lists them: each once.
  var repositories: [TrackedRepository] {
    var seen: Set<RepositoryAddress> = []
    return model.settings.repositories.filter { seen.insert($0.address).inserted }
  }

  /// The views as the sidebar lists them: each once.
  var views: [SavedView] {
    var seen: Set<String> = []
    return model.settings.views.filter { seen.insert($0.id).inserted }
  }

  /// The sidebar's entries in visual order, which ⌘1…⌘9 follow: All, the
  /// repositories, then the views.
  var entries: [SidebarItem] {
    [.all] + repositories.map { .repository($0.address) } + views.map { .view(id: $0.id) }
  }

  /// Selects the entry at a place in visual order, counted from 0.
  func selectEntry(at position: Int) {
    guard entries.indices.contains(position) else { return }
    model.selection = entries[position]
  }

  /// How many open issues the tracked repositories have together, once
  /// every one available has said.
  var allCount: Int? {
    var total = 0
    for repository in repositories {
      if let summary = summaries[repository.address] {
        total += summary.openIssueCount
      } else if problems[repository.address] == nil {
        return nil
      }
    }
    return total
  }

  /// Whether the sidebar's entries can be changed: not while settings.json
  /// cannot be read, which a write would overwrite.
  var canChange: Bool { model.settingsProblem == nil }

  // MARK: Reading counts

  /// Reads every count again: the tracked repositories' summaries and the
  /// views' match counts.
  func refreshSummaries() async {
    refreshedAt = .now
    async let summarized: Void = summarize(repositories.map(\.address))
    async let counted: Void = count(Set(views.map(\.query)))
    _ = await (summarized, counted)
  }

  /// Reads the counts not known yet, e.g. of a repository just added or a
  /// view whose search changed.
  func refreshUnknown() async {
    if refreshedAt == nil { refreshedAt = .now }
    let addresses = repositories.map(\.address).filter { summaries[$0] == nil && problems[$0] == nil }
    let queries = Set(views.map(\.query)).filter { matchCounts[$0] == nil }
    async let summarized: Void = summarize(addresses)
    async let counted: Void = count(queries)
    _ = await (summarized, counted)
  }

  /// Reads the counts again every five minutes while the app is in front,
  /// until cancelled.
  func revalidate() async {
    while !Task.isCancelled {
      try? await Task.sleep(for: .seconds(60))
      guard NSApp.isActive, let refreshedAt, Date.now.timeIntervalSince(refreshedAt) > Self.freshFor else { continue }
      await refreshSummaries()
    }
  }

  /// Reads repositories' summaries, 100 at a time, and stores where any
  /// renamed or transferred repository is now.
  private func summarize(_ addresses: [RepositoryAddress]) async {
    guard let client = model.client else { return }
    let wanted = addresses.filter { !asking.contains($0) }
    guard !wanted.isEmpty else { return }
    asking.formUnion(wanted)
    defer { asking.subtract(wanted) }
    var found: [RepositoryAddress: TrackedRepository] = [:]
    var lookUp: [(RepositoryAddress, Int)] = []
    for batch in wanted.chunked(into: 100) {
      do {
        let results = try await client.repositorySummaries(batch)
        for (address, result) in zip(batch, results) {
          let tracked = model.settings.repositories.first { $0.address == address }
          switch result {
          case .success(let summary):
            switch tracked?.identity(from: summary) ?? .unchanged {
            case .unchanged:
              store(summary, for: address)
            case .identified(let current):
              found[address] = current
              store(summary, for: current.address)
            case .takenOver:
              summaries[address] = nil
              problems[address] = .unavailable(
                "\(address) is now another repository. Verdandi is looking for the one you track.")
              if let id = tracked?.githubId { lookUp.append((address, id)) }
            }
          case .failure(let error):
            problems[address] = error
            if case .unavailable = error, let id = tracked?.githubId { lookUp.append((address, id)) }
          }
        }
      } catch {
        for address in batch where summaries[address] == nil { problems[address] = error }
      }
    }
    // Where the name leads elsewhere or nowhere, GitHub's ID tells where
    // the repository went, if anywhere this account can see.
    for (address, id) in lookUp {
      guard let current = try? await client.repositoryAddress(id: id), current != address else { continue }
      found[address] = TrackedRepository(address: current, githubId: id)
      problems[address] = nil
    }
    identify(found)
  }

  private func store(_ summary: RepositorySummary, for address: RepositoryAddress) {
    if summaries[address] != summary { summaries[address] = summary }
    problems[address] = nil
  }

  /// Stores tracked repositories' new addresses and IDs in settings.json,
  /// and keeps a selected one selected under its new address.
  private func identify(_ found: [RepositoryAddress: TrackedRepository]) {
    guard !found.isEmpty, canChange else { return }
    change { $0.identify(found) }
    for (old, current) in found where old != current.address {
      summaries[old] = nil
      problems[old] = nil
    }
    if case .repository(let selected) = model.selection, let current = found[selected] {
      model.selection = .repository(current.address)
    }
  }

  /// Counts the matches of searches, one at a time, as the search API
  /// allows only 30 searches a minute.
  private func count(_ queries: Set<String>) async {
    guard let client = model.client else { return }
    for query in queries.sorted() where !counting.contains(query) {
      counting.insert(query)
      defer { counting.remove(query) }
      do {
        let page = try await client.searchPreview(query, count: 1)
        matchCounts[query] = .known(page.total, incomplete: page.incomplete)
      } catch {
        if case .invalidSearch(let message) = error {
          matchCounts[query] = .rejected(message)
        } else if case .known = matchCounts[query] {
          // A count known before stays shown when reading it again fails.
        } else {
          matchCounts[query] = .failed(error)
        }
      }
    }
  }

  /// Takes a count the view editor already read, so that saving the view
  /// does not search again.
  func takeMatchCount(_ count: MatchCount, for query: String) {
    matchCounts[query] = count
  }

  // MARK: Changing entries

  /// Changes settings.json, starting from the file as it is now, so that a
  /// change made outside the app since is kept. Nothing is written while
  /// the file cannot be read.
  private func change(_ change: (inout Settings) -> Void) {
    reloadSettings()
    guard canChange else {
      model.report("Cannot Change the Sidebar", model.settingsProblem ?? "settings.json cannot be read.")
      return
    }
    model.changeSettings(change)
  }

  /// Opens the repository picker.
  func showRepositoryPicker() {
    model.sheet = .repositoryPicker
  }

  /// Tracks repositories the picker found, at the end of the sidebar, and
  /// selects the first.
  func addRepositories(_ added: [RepositoryAccess]) {
    guard !added.isEmpty else { return }
    change { settings in
      settings.track(added.map { TrackedRepository(address: $0.repository, githubId: $0.id) })
    }
    if let first = added.first { model.selection = .repository(first.repository) }
  }

  /// Opens the view editor for a new view.
  func newView() {
    model.sheet = .viewEditor(nil)
  }

  /// Opens the view editor for a view.
  func edit(_ viewID: String) {
    guard let view = model.view(id: viewID) else { return }
    model.sheet = .viewEditor(view)
  }

  /// Opens the view editor for a new view with a view's search.
  func duplicate(_ viewID: String) {
    guard let view = model.view(id: viewID) else { return }
    model.sheet = .viewEditor(view, duplicate: true)
  }

  /// Saves a view the editor made: in place when it is listed, otherwise
  /// after the view `after`, or at the end, and selects a new one.
  func saveView(_ view: SavedView, after: String? = nil) {
    let isNew = model.view(id: view.id) == nil
    change { $0.save(view, after: after) }
    if isNew, model.view(id: view.id) != nil { model.selection = .view(id: view.id) }
  }

  /// Asks the user to confirm removing an entry; All cannot be removed.
  func requestRemoval(_ item: SidebarItem?) {
    guard let item, item != .all, canChange else { return }
    pendingRemoval = item
  }

  /// Removes a tracked repository or a view from the sidebar; nothing on
  /// GitHub changes. Removing the selected entry selects All.
  func remove(_ item: SidebarItem) {
    switch item {
    case .all:
      return
    case .repository(let address):
      change { $0.untrack(address) }
      summaries[address] = nil
      problems[address] = nil
    case .view(let id):
      change { $0.removeView(id: id) }
    }
    if model.selection == item { model.selection = .all }
  }

  /// Reorders the tracked repositories, as dragged in the sidebar.
  func moveRepositories(fromOffsets source: IndexSet, toOffset destination: Int) {
    var reordered = repositories
    reordered.move(fromOffsets: source, toOffset: destination)
    change { $0.repositories = reordered }
  }

  /// Reorders the views, as dragged in the sidebar.
  func moveViews(fromOffsets source: IndexSet, toOffset destination: Int) {
    var reordered = views
    reordered.move(fromOffsets: source, toOffset: destination)
    change { $0.views = reordered }
  }

  /// Moves an entry up (-1) or down (+1) within its section.
  func move(_ item: SidebarItem?, by step: Int) {
    switch item {
    case .repository(let address):
      guard let index = repositories.firstIndex(where: { $0.address == address }),
        repositories.indices.contains(index + step)
      else { return }
      moveRepositories(fromOffsets: [index], toOffset: step > 0 ? index + step + 1 : index + step)
    case .view(let id):
      guard let index = views.firstIndex(where: { $0.id == id }), views.indices.contains(index + step) else { return }
      moveViews(fromOffsets: [index], toOffset: step > 0 ? index + step + 1 : index + step)
    case .all, nil:
      return
    }
  }

  // MARK: The selected entry, for the menus

  /// The selected view's ID, while a view is selected.
  var selectedViewID: String? {
    if case .view(let id) = model.selection { return id }
    return nil
  }

  /// Whether the selected entry can be removed or moved: a repository or a
  /// view, while settings.json can be changed.
  var canChangeSelection: Bool {
    guard canChange, let selection = model.selection else { return false }
    return selection != .all
  }

  func editSelectedView() {
    if let selectedViewID { edit(selectedViewID) }
  }

  func duplicateSelectedView() {
    if let selectedViewID { duplicate(selectedViewID) }
  }

  /// Asks to remove the selected entry, as ⌫ does.
  func removeSelection() {
    requestRemoval(model.selection)
  }

  /// Moves the selected entry up (-1) or down (+1) within its section.
  func moveSelection(by step: Int) {
    move(model.selection, by: step)
  }

  // MARK: Watching settings.json

  /// Watches settings.json for changes made outside the app, e.g. by hand
  /// or by the Electron app, and reloads the sidebar when it changes.
  func watchSettings() {
    guard watcher == nil else { return }
    let watcher = FileWatcher(url: model.settingsFile.url) { [weak self] in
      Task { @MainActor in self?.reloadSettings() }
    }
    watcher.start()
    self.watcher = watcher
  }

  /// Reads settings.json again, unless it says what the app has already,
  /// as after the app's own writes. An entry no longer listed is no longer
  /// selected.
  func reloadSettings() {
    if let read = try? model.settingsFile.read(), read == model.settings, model.settingsProblem == nil { return }
    // A selected repository stays selected under a new address, by its ID.
    var selectedId: Int?
    if case .repository(let address) = model.selection {
      selectedId = model.settings.repositories.first { $0.address == address }?.githubId
    }
    model.loadSettings()
    switch model.selection {
    case .repository(let address) where !model.settings.repositories.contains(where: { $0.address == address }):
      let moved = selectedId.flatMap { id in model.settings.repositories.first { $0.githubId == id } }
      model.selection = moved.map { .repository($0.address) } ?? .all
    case .view(let id) where model.view(id: id) == nil:
      model.selection = .all
    default:
      break
    }
    if let pendingRemoval, !entries.contains(pendingRemoval) { self.pendingRemoval = nil }
  }
}
