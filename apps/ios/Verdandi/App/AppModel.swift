import SwiftUI
import VerdandiKit
import os

/// A sidebar entry, as the app selects one: All, a tracked repository or a
/// view.
enum SidebarItem: Hashable, Codable {
    case all
    case repository(RepositoryAddress)
    case view(id: String)

    /// The list it opens, unless it is a view.
    var scope: Scope? {
        switch self {
        case .all: .all
        case .repository(let repository): .repository(repository)
        case .view: nil
        }
    }

    /// The list whose issues expand and whose labels filter.
    var expandableList: ExpandableList {
        switch self {
        case .all: .scope(.all)
        case .repository(let repository): .scope(.repository(repository))
        case .view(let id): .view(id: id)
        }
    }

    var screen: Screen {
        switch self {
        case .all: .list(.all)
        case .repository(let repository): .list(.repository(repository))
        case .view(let id): .view(id: id)
        }
    }

    var savedEntry: SavedEntry {
        switch self {
        case .all: .all
        case .repository(let repository): .repository(repository)
        case .view(let id): .view(id: id)
        }
    }
}

/// An issue page the user went to, as the place it was opened from named it,
/// enough to show it before its page has loaded.
struct IssueRoute: Hashable, Codable, Identifiable {
    var id: String
    /// `#12` or `owner/name#12`.
    var reference: String
    var title: String
    var url: String?

    init(id: String, reference: String, title: String, url: String? = nil) {
        self.id = id
        self.reference = reference
        self.title = title
        self.url = url
    }

    init(_ issue: IssueInfo) {
        self.init(id: issue.id, reference: issue.reference, title: issue.title, url: issue.url)
    }

    var tabIssue: TabIssue { TabIssue(id: id, reference: reference, title: title, url: url) }
}

/// A notice shown for a while, then gone.
struct ShownNotice: Identifiable, Equatable {
    let id = UUID()
    var text: String
    var systemImage: String
}

/// The app's state: what the core has pushed, and where the user is. The
/// core decides what is read and when; this only shows it, and asks the core
/// as the user moves.
@MainActor @Observable
final class AppModel {
    enum Phase: Equatable {
        case starting
        case failed(String)
        case running
    }

    static let log = Logger(subsystem: "io.github.chris-metz.verdandi", category: "app")

    private(set) var phase: Phase = .starting
    private(set) var core: Core?
    let credentials: Credentials
    let launch: LaunchOptions

    // What the core pushed.
    var setup: Setup = .checking
    var sidebar: SidebarEntries?
    var lists: [Scope: IssueList] = [:]
    var views: [String: ViewList] = [:]
    var pages: [String: IssuePage] = [:]
    var rateLimits: [RateLimitState] = []
    var budgets: [RateLimitBudget] = []
    var suggestions: RepositorySuggestions?
    var config: ConfigState?
    var themes: [Theme] = []
    var recentIssues: [RecentIssue] = []
    var notices: [ShownNotice] = []

    // Where the user is.
    var selection: SidebarItem? = .all
    /// The issue chosen in the list, shown beside it or pushed over it.
    var selectedIssue: IssueRoute?
    /// The issues opened from that page, one after another.
    var issuePath: [IssueRoute] = []
    /// The sheet shown over everything, if any.
    var sheet: Sheet?

    enum Sheet: String, Identifiable {
        case repositoryPicker, newView, settings, goToIssue
        var id: String { rawValue }
    }

    /// The view being edited, when the view editor edits one.
    var editedView: SavedView?
    /// The view the view editor makes a copy of, when it duplicates one:
    /// the copy is a new view that goes right after it.
    var duplicatedView: SavedView?

    init(credentials: Credentials = Credentials(), launch: LaunchOptions = .current) {
        self.credentials = credentials
        self.launch = launch
    }

    // MARK: - Starting

    /// Starts the core and reads what the app shows first.
    func start() async {
        guard phase == .starting, core == nil else { return }
        guard let url = Bundle.main.url(forResource: "core", withExtension: "js"),
            let script = try? String(contentsOf: url, encoding: .utf8)
        else {
            phase = .failed("The app's copy of the core is missing. Build the app again.")
            return
        }
        let core: Core
        do {
            let home = try launch.home ?? Self.defaultHome()
            core = try Core(
                script: script,
                options: .init(
                    // Unencoded: "Application Support" has a space.
                    home: home.path(percentEncoded: false), interfaceFont: "SF Pro", codeFont: "SF Mono",
                    installedFonts: ["SF Pro", "SF Mono"]),
                github: GitHubAPI(credentials: credentials))
        } catch {
            phase = .failed(error.localizedDescription)
            return
        }
        self.core = core
        phase = .running
        Task { [weak self] in
            for await event in core.events { self?.apply(event) }
        }
        themes = await core.themes()
        await attempt { self.config = try await core.getConfig() }
        await attempt { self.setup = try await core.getSetup() }
        await attempt { self.sidebar = try await core.getSidebar() }
        await attempt { self.recentIssues = try await core.getRecentIssues() }
        await attempt { self.rateLimits = try await core.getRateLimits() }
        await attempt { self.budgets = try await core.getRateLimitBudgets() }
        await restoreTabs()
        await launch.apply(to: self)
    }

    /// Where the core keeps its files: the app's own, out of the user's sight.
    static func defaultHome() throws -> URL {
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return support.appending(path: "Verdandi", directoryHint: .isDirectory)
    }

    /// Runs a request, logging what fails: the core reports what matters
    /// to the user through the state it pushes.
    func attempt(_ action: () async throws -> Void) async {
        do {
            try await action()
        } catch {
            Self.log.error("A request failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: - Events

    func apply(_ event: CoreEvent) {
        switch event {
        case .setupChanged(let setup): self.setup = setup
        case .notice(let notice): show(notice)
        case .listChanged(let list): lists[list.scope] = list
        case .issuePageChanged(let page):
            pages[page.issueId] = page
            resumeListBeside(page)
        case .viewChanged(let list): views[list.view.id] = list
        case .sidebarChanged(let sidebar):
            self.sidebar = sidebar
            dropGoneSelection()
        case .rateLimitsChanged(let limits): rateLimits = limits
        case .rateLimitBudgetsChanged(let budgets): self.budgets = budgets
        case .repositorySuggestionsChanged(let suggestions): self.suggestions = suggestions
        case .configChanged(let config): self.config = config
        }
    }

    func show(_ notice: Notice) {
        let text: String
        let image: String
        switch notice {
        case .accountChanged(let previous, let account):
            text = "GitHub is read as @\(account.login) now, no longer as @\(previous.login)."
            image = "person.crop.circle.badge.checkmark"
        case .repositoriesRenamed(let renamed):
            text = renamed.map { "\($0.from.nameWithOwner) is now \($0.to.nameWithOwner)." }.joined(separator: " ")
            image = "arrow.triangle.branch"
        case .duplicateRepositoriesRemoved(let removed):
            text = removed.map { "\($0.repository.nameWithOwner) was listed twice, as \($0.sameAs.nameWithOwner)." }
                .joined(separator: " ")
            image = "rectangle.stack.badge.minus"
        case .ghReplaced:
            return
        }
        post(text, systemImage: image)
    }

    /// Shows a notice for a few seconds.
    func post(_ text: String, systemImage: String = "info.circle") {
        let notice = ShownNotice(text: text, systemImage: systemImage)
        withAnimation(.snappy) { notices.append(notice) }
        Task {
            try? await Task.sleep(for: .seconds(6))
            withAnimation(.snappy) { notices.removeAll { $0.id == notice.id } }
        }
    }

    /// A selected view or repository that is no longer in the sidebar
    /// leaves All selected.
    private func dropGoneSelection() {
        guard case .read(let entries) = sidebar, let selection else { return }
        switch selection {
        case .all: return
        case .repository(let repository):
            if !entries.repositories.contains(where: { $0.repository.address.sameRepository(as: repository) }) {
                select(.all)
            }
        case .view(let id):
            if !entries.views.contains(where: { $0.view.id == id }) { select(.all) }
        }
    }

    // MARK: - Moving

    /// The screen the user looks at: the issue page on top, or the list.
    var shownScreen: Screen? {
        if let issue = issuePath.last ?? selectedIssue { return .issue(id: issue.id) }
        return selection?.screen
    }

    /// Chooses a sidebar entry, and has the core open its list.
    func select(_ item: SidebarItem?) {
        if selection != item {
            selection = item
            selectedIssue = nil
            issuePath = []
        }
        openShown()
    }

    /// Opens an issue's page over or beside the list.
    func openIssue(_ route: IssueRoute, fromPage: Bool = false) {
        if fromPage {
            issuePath.append(route)
        } else {
            selectedIssue = route
            issuePath = []
        }
        openShown()
    }

    /// Tells the core what is on screen now, as the user moved, so that it
    /// reads it and drops what it no longer needs.
    func openShown() {
        let screen = shownScreen
        Task {
            await show(screen)
            await saveTabs()
        }
    }

    /// The screen the core was last told is shown. The core reads one screen
    /// at a time, and drops what another still needed.
    private var coreScreen: Screen?

    /// The last screen sent to the core, which the next waits for: sent
    /// from separate tasks, two could reach the core in the wrong order and
    /// leave the screen shown last unread.
    private var showing: Task<Void, Never>?

    /// Runs a request that has the core show a screen, after those sent
    /// before it: sent from separate tasks, two could reach the core in the
    /// wrong order, and the core would read the wrong screen.
    private func send(_ screen: Screen?, _ request: @escaping (Core) async throws -> Void) async {
        guard let core else { return }
        coreScreen = screen
        let previous = showing
        let next = Task {
            await previous?.value
            await attempt { try await request(core) }
        }
        showing = next
        await next.value
    }

    /// Has the core show a screen: it reads what it lacks or what is old.
    private func show(_ screen: Screen?) async {
        await send(screen) { core in
            switch screen {
            case .list(let scope): try await core.openList(scope)
            case .view(let id): try await core.openView(id)
            case .issue(let id): try await core.openIssuePage(id)
            case nil: break
            }
        }
    }

    /// Before the user changes a list, such as expanding an issue whose
    /// sub-issues are not read yet, it is the screen the core shows: on an
    /// iPad the issue page beside it may be, and the core drops what a
    /// screen not shown asks for.
    func showList(_ list: ExpandableList) async {
        let screen: Screen =
            switch list {
            case .scope(let scope): .list(scope)
            case .view(let id): .view(id: id)
            }
        if coreScreen != screen { await show(screen) }
    }

    /// Switches a scope's list to its open or closed issues, which the core
    /// then shows.
    func switchState(_ scope: Scope, to state: IssueState) async {
        await send(.list(scope)) { try await $0.switchState(scope, to: state) }
    }

    /// Whether the list stays in sight beside the issue page, as in an
    /// iPad's columns; the window says so as its size changes.
    var listBesideIssue = false

    /// On an iPad, the list stays beside the issue page; but the core reads
    /// only the screen shown, and stops reading the list as the page opens.
    /// Once the page has loaded, the list is shown to the core again, so that
    /// it finishes loading too.
    private func resumeListBeside(_ page: IssuePage) {
        guard listBesideIssue, case .issue(let id) = coreScreen, id == page.issueId,
            !page.loading.isBusy, let selection, !settled(selection)
        else { return }
        let screen = selection.screen
        Task { await show(screen) }
    }

    /// Whether a sidebar entry's list has loaded all it shows.
    private func settled(_ item: SidebarItem) -> Bool {
        switch item {
        case .view(let id):
            guard let view = views[id] else { return false }
            return !view.loading.isBusy && !view.readingContext
        default:
            guard let scope = item.scope, let list = lists[scope] else { return false }
            return !list.loading.state.isBusy
        }
    }

    /// Before an issue page asks the core for more, such as the next steps
    /// of its blocking map, it is the screen the core shows: the core drops
    /// what a screen not shown asks for.
    func showPage(_ issueId: String) async {
        if coreScreen != .issue(id: issueId) { await show(.issue(id: issueId)) }
    }

    /// Explores or folds one side of a page's blocking map.
    func activateBlockingEnd(_ issueId: String, side: BlockingSide) async {
        guard let core else { return }
        await showPage(issueId)
        await attempt { try await core.activateBlockingEnd(issueId, side: side) }
    }

    /// Reads one card's relationships in a page's blocking map again.
    func retryBlockingBranch(_ issueId: String, cardId: String, side: BlockingSide) async {
        guard let core else { return }
        await showPage(issueId)
        await attempt { try await core.retryBlockingBranch(issueId, cardId: cardId, side: side) }
    }

    /// Reads a body on a page again for fresh links to its media.
    func renewMediaLinks(_ issueId: String, bodyId: String) async -> RenewedMediaLinks? {
        guard let core else { return nil }
        await showPage(issueId)
        do {
            return try await core.renewMediaLinks(issueId, bodyId: bodyId)
        } catch {
            return .failed(.error(message: error.localizedDescription))
        }
    }

    /// Reads a screen again now: the one the user looks at, or another in
    /// sight, such as the list beside an iPad's issue page.
    func refresh(_ screen: Screen? = nil) async {
        let screen = screen ?? shownScreen
        await send(screen) { try await $0.refresh(screen) }
    }

    /// Reads again what failed on a screen, by default the one on top.
    func retry(_ screen: Screen? = nil) async {
        let screen = screen ?? shownScreen
        await send(screen) { try await $0.retry(screen) }
    }

    /// As the app comes back to the front: what is old or failed is read
    /// again, and the token's account checked.
    func revalidate() async {
        guard phase == .running else { return }
        let screen = shownScreen
        await send(screen) { try await $0.revalidate(screen) }
    }

    /// Keeps the issue page in the recent issues.
    func recordRecent(_ issue: IssueInfo) {
        guard let core, let number = issue.number else { return }
        let recent = RecentIssue(id: issue.id, repository: issue.repository, number: number, title: issue.title)
        guard recentIssues.first != recent else { return }
        Task {
            await attempt {
                try await core.recordRecentIssue(recent)
                self.recentIssues = try await core.getRecentIssues()
            }
        }
    }

    // MARK: - Tabs

    /// Where the user was, kept as the desktop app keeps a tab.
    private func saveTabs() async {
        guard let core, let selection else { return }
        let issues = ([selectedIssue].compactMap { $0 } + issuePath).map(\.tabIssue)
        await attempt {
            try await core.saveTabs(SavedTabs(tabs: [SavedTab(entry: selection.savedEntry, issues: issues)], shown: 0))
        }
    }

    /// Comes back to where the user was at the last launch.
    private func restoreTabs() async {
        guard let core, !launch.selects else { return }
        guard let tabs = try? await core.getTabs(), let tab = tabs.tabs[safe: tabs.shown] ?? tabs.tabs.first,
            case .entry(let entry, let issues) = tab
        else {
            select(.all)
            return
        }
        switch entry {
        case .all: selection = .all
        case .repository(let repository): selection = .repository(repository)
        case .view(let view): selection = .view(id: view.id)
        }
        let routes = issues.map { IssueRoute(id: $0.id, reference: $0.reference, title: $0.title, url: $0.url) }
        selectedIssue = routes.first
        issuePath = Array(routes.dropFirst())
        // The list is read too, so that going back finds it.
        if let selection, selectedIssue != nil { await show(selection.screen) }
        openShown()
    }

    // MARK: - Signing in

    /// Keeps the token and checks it with GitHub.
    func signIn(token: String) async throws {
        try credentials.store(token)
        guard let core else { return }
        setup = try await core.checkSetupAgain()
    }

    /// Forgets the token; the core then asks GitHub nothing more.
    func signOut() async {
        do {
            try credentials.remove()
        } catch {
            post(error.localizedDescription, systemImage: "exclamationmark.triangle")
        }
        guard let core else { return }
        await attempt { self.setup = try await core.checkSetupAgain() }
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
