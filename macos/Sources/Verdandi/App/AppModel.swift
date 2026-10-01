import Foundation
import Observation
import VerdandiCore

/// Whether Verdandi can reach GitHub through gh.
enum SetupState: Equatable {
  case checking
  case ready(login: String)
  /// No usable gh, with those found that cannot be used.
  case ghMissing(unusable: [UnusableGh])
  case signedOut
  case rejected(login: String?, message: String)
  /// The check itself failed, e.g. offline.
  case failed(String)
}

/// A sheet over the window.
enum AppSheet: Identifiable, Hashable {
  /// Adding tracked repositories.
  case repositoryPicker
  /// Creating a view, or editing one, or creating a copy of one.
  case viewEditor(SavedView?, duplicate: Bool = false)
  /// Going to an issue by its reference.
  case goToIssue

  var id: Self { self }
}

/// A message shown over the window for a while, e.g. a failed request.
struct Notice: Identifiable, Equatable {
  /// What a notice is about, which picks its icon.
  enum Kind: Equatable {
    case problem
    /// GitHub could not be reached.
    case offline
    /// A rate limit held a request back.
    case rateLimited
    case info
  }

  let id = UUID()
  var kind: Kind = .problem
  var title: String
  var message: String
  /// How often it was reported while shown: the same notice again only
  /// counts up.
  var count = 1
  /// When it was last reported, from which it shows for a while again.
  var reportedAt = Date.now
}

/// The app's state: setup, settings, navigation, and the stores of the
/// features. Each feature keeps its own store; this ties them together.
@Observable
final class AppModel {
  // MARK: Setup

  private(set) var setup: SetupState = .checking
  private(set) var gh: GhExecutable?
  private(set) var client: GitHubClient?

  // MARK: Settings

  private(set) var settings = Settings()
  /// Why settings.json could not be read, while it cannot.
  private(set) var settingsProblem: String?
  @ObservationIgnored let settingsFile = SettingsFile()

  // MARK: Navigation

  /// The sidebar's selection. Choosing another entry shows its list, with
  /// no issue page over it. The app opens on it again at the next launch.
  var selection: SidebarItem? = .all {
    didSet {
      if selection != oldValue {
        issuePath = []
        keepLastEntry()
      }
    }
  }
  /// The list's cursor: the issue its keys move between, and Return opens.
  var selectedIssueID: String?
  /// The issue pages opened over the list, oldest first: the last one shows.
  /// While it is empty, the list shows. Following an issue from a page adds
  /// one; going back takes the last one away.
  var issuePath: [IssueVisit] = []
  /// The sheet over the window, if any.
  var sheet: AppSheet?
  /// Whether the entry chosen last has been selected again, which waits
  /// until settings.json can be read. Until then nothing is kept.
  @ObservationIgnored private var hasRestoredLastEntry = false

  // MARK: Shared state

  let issues = IssueStore()
  private(set) var rateLimits: [RateLimitPool: RateLimitBudget] = [:]
  var notices: [Notice] = []

  // MARK: Feature stores

  @ObservationIgnored private(set) lazy var lists = ListsStore(model: self)
  @ObservationIgnored private(set) lazy var pages = IssuePagesStore(model: self)
  @ObservationIgnored private(set) lazy var sidebar = SidebarStore(model: self)

  init() {
    loadSettings()
  }

  // MARK: Setup

  /// Looks for gh and asks it whether it is signed in.
  func checkSetup() async {
    setup = .checking
    let chosen = UserDefaults.standard.string(forKey: "ghPath").map(URL.init(fileURLWithPath:))
    switch await findGh(chosen: chosen) {
    case .notFound(let unusable):
      gh = nil
      client = nil
      setup = .ghMissing(unusable: unusable)
    case .found(let found):
      gh = found
      let client = GitHubClient(gh: found.url) { [weak self] budget in
        Task { @MainActor in self?.rateLimits[budget.pool] = budget }
      }
      do {
        switch try await client.authStatus() {
        case .signedIn(let login):
          self.client = client
          setup = .ready(login: login)
        case .signedOut:
          setup = .signedOut
        case .rejected(let login, let message):
          setup = .rejected(login: login, message: message)
        }
      } catch {
        setup = .failed(error.message)
      }
    }
  }

  /// Uses a gh the user chose, if it is a usable one.
  func chooseGh(_ url: URL) async -> UnusableGh? {
    switch await probeGh(url) {
    case .success:
      UserDefaults.standard.set(url.path, forKey: "ghPath")
      await checkSetup()
      return nil
    case .failure(let problem):
      return problem
    }
  }

  var login: String? {
    if case .ready(let login) = setup { return login }
    return nil
  }

  // MARK: Settings

  func loadSettings() {
    do {
      settings = try settingsFile.read()
      settingsProblem = nil
      restoreLastEntry()
    } catch {
      settingsProblem = error.localizedDescription
    }
  }

  /// Changes the settings and writes them to settings.json.
  func changeSettings(_ change: (inout Settings) -> Void) {
    // A file that cannot be read would be overwritten with what was last
    // read; it stays as it is until it can be read again.
    guard settingsProblem == nil else { return }
    var changed = settings
    change(&changed)
    guard changed != settings else { return }
    settings = changed
    do {
      try settingsFile.write(changed)
    } catch {
      report("Could not save settings", error.localizedDescription)
    }
  }

  func view(id: String) -> SavedView? {
    settings.views.first { $0.id == id }
  }

  // MARK: Navigation

  /// The issue whose page shows, if one does.
  var shownIssueID: String? { issuePath.last?.issueID }

  /// Opens an issue's page over what shows now, its cursor on the issue.
  func openIssue(_ id: String) {
    if shownIssueID != id { issuePath.append(IssueVisit(issueID: id)) }
  }

  /// Goes back to what showed before the current issue page: the page
  /// before it, or the list.
  func goBack() {
    if !issuePath.isEmpty { issuePath.removeLast() }
  }

  /// Selects the entry chosen last again, with its label filter, the first
  /// time settings.json is read, unless the launch options select another.
  private func restoreLastEntry() {
    guard !hasRestoredLastEntry else { return }
    hasRestoredLastEntry = true
    guard LaunchOptions.selection == nil else { return }
    let last = LastEntry.load(in: settings)
    lists.list(for: last.item).addLabels(last.labelFilter)
    selection = last.item
  }

  /// Keeps the selected entry and its label filter on this Mac, to open on
  /// them again at the next launch. A launch whose launch options select an
  /// entry keeps nothing: it is for screenshots.
  func keepLastEntry() {
    guard hasRestoredLastEntry, LaunchOptions.selection == nil, let selection else { return }
    LastEntry(item: selection, labelFilter: lists.list(for: selection).labelFilter).save(in: settings)
  }

  /// Reads again what the window shows: the sidebar's counts, and the issue
  /// page or else the list.
  func refreshShown() async {
    async let summaries: Void = sidebar.refreshSummaries()
    if let shownIssueID {
      await pages.refresh(shownIssueID)
    } else if let selection {
      await lists.refresh(selection)
    }
    await summaries
  }

  // MARK: Notices

  /// Shows a notice, or counts up the same one while it shows.
  func report(_ title: String, _ message: String, kind: Notice.Kind = .problem) {
    if let index = notices.firstIndex(where: { $0.kind == kind && $0.title == title && $0.message == message }) {
      notices[index].count += 1
      notices[index].reportedAt = .now
    } else {
      notices.append(Notice(kind: kind, title: title, message: message))
    }
  }

  func report(_ title: String, _ error: GitHubError) {
    let kind: Notice.Kind =
      switch error {
      case .rateLimited: .rateLimited
      case .ghFailed: .offline
      default: .problem
      }
    report(title, error.message, kind: kind)
  }

  // MARK: Launch options

  /// Shows a setup state without asking gh, as `VERDANDI_SETUP` asks for
  /// screenshots of the setup screen.
  func pretendSetup(_ state: SetupState) {
    setup = state
  }
}
