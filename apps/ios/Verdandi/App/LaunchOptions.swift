import Foundation
import VerdandiKit

/// What a launch for development asks of the app, through environment
/// variables (`SIMCTL_CHILD_…` with `xcrun simctl launch`, as
/// `scripts/run-simulator.sh` passes them), so that a state can be shown and
/// photographed without tapping to it:
///
/// - `VERDANDI_HOME`: another folder for the core's files, e.g. an empty one
///   for a first launch; `fresh` makes a new empty one in the app's own
///   temporary folder, as UI tests use.
/// - `VERDANDI_SELECT`: `all`, `repo:owner/name` or `view:<id>`.
/// - `VERDANDI_ISSUE`: `owner/name#12`, opened over the selected list.
/// - `VERDANDI_SHEET`: `repositoryPicker`, `newView`, `settings` or `goToIssue`.
/// - `VERDANDI_APPEARANCE`: `light` or `dark`, whatever `config.toml` says.
/// - `VERDANDI_TRACK`: `owner/name,owner/name`, tracked unless they are.
/// - `VERDANDI_VIEW`: `Name|search`, saved as a view unless one has the name.
/// - `VERDANDI_ISSUE_ID`: an issue's node ID, its page opened without
///   looking it up, e.g. one GitHub does not show.
/// - `VERDANDI_SCROLL`: `map`, `comments` or `end`, where an issue page
///   scrolls once it has loaded.
/// - `VERDANDI_EXPAND`: `1`, every sub-issue on an issue page expanded.
/// - `VERDANDI_SIGNED_OUT=1`: no token at all: the environment's is ignored
///   and the Keychain's forgotten, to show signing in.
/// - `VERDANDI_SIGN_IN`: a token signed in with at launch, as if typed: a
///   made-up one, to see GitHub reject it.
/// - `VERDANDI_CLIENT_ID`: a GitHub OAuth App's client ID for Sign in with
///   GitHub, instead of the bundle's `VerdandiGitHubClientID`.
/// - `VERDANDI_DEVICE_FLOW`: `start` signs in with GitHub at once; `demo`
///   does so with a made-up GitHub that hands out a code and waits, to show
///   the code without an OAuth App.
/// - `VERDANDI_GO_TO`: typed into Go to Issue; `VERDANDI_GO_TO_SUBMIT=1`
///   then goes to it, as Return would.
/// - `VERDANDI_NOTICE`: shown as a notice once the app has started.
/// - `VERDANDI_SETTINGS=about`: Settings opens on About.
struct LaunchOptions {
    var home: URL?
    var select: SidebarItem?
    var issue: (repository: RepositoryAddress, number: Int)?
    var sheet: AppModel.Sheet?
    var appearance: Appearance?
    var track: [RepositoryAddress] = []
    var view: (name: String, query: String)?
    var issueId: String?
    var scroll: String?
    var expandsSubIssues = false
    var signedOut = false
    var signInToken: String?
    var clientID: String?
    var deviceFlow: DeviceFlowLaunch?
    var goTo: String?
    var goToSubmits = false
    var notice: String?
    var settingsPage: String?

    enum DeviceFlowLaunch: String { case start, demo }

    /// Whether the launch chooses where the app opens.
    var selects: Bool { select != nil || issue != nil || issueId != nil }

    static var current: LaunchOptions {
        let environment = ProcessInfo.processInfo.environment
        var options = LaunchOptions()
        if let home = environment["VERDANDI_HOME"], !home.isEmpty {
            options.home =
                home == "fresh"
                ? FileManager.default.temporaryDirectory.appending(path: "home-\(UUID().uuidString)", directoryHint: .isDirectory)
                : URL(filePath: home, directoryHint: .isDirectory)
        }
        if let select = environment["VERDANDI_SELECT"] {
            if select == "all" {
                options.select = .all
            } else if select.hasPrefix("repo:"), let repository = RepositoryAddress(parsing: String(select.dropFirst(5))) {
                options.select = .repository(repository)
            } else if select.hasPrefix("view:") {
                options.select = .view(id: String(select.dropFirst(5)))
            }
        }
        if let issue = environment["VERDANDI_ISSUE"], let hash = issue.lastIndex(of: "#"),
            let repository = RepositoryAddress(parsing: String(issue[..<hash])),
            let number = Int(issue[issue.index(after: hash)...])
        {
            options.issue = (repository, number)
        }
        options.sheet = environment["VERDANDI_SHEET"].flatMap(AppModel.Sheet.init(rawValue:))
        options.appearance = environment["VERDANDI_APPEARANCE"].flatMap(Appearance.init(rawValue:))
        options.track = (environment["VERDANDI_TRACK"] ?? "").split(separator: ",").compactMap {
            RepositoryAddress(parsing: String($0))
        }
        if let view = environment["VERDANDI_VIEW"], let bar = view.firstIndex(of: "|") {
            options.view = (String(view[..<bar]), String(view[view.index(after: bar)...]))
        }
        options.issueId = environment["VERDANDI_ISSUE_ID"].flatMap { $0.isEmpty ? nil : $0 }
        options.scroll = environment["VERDANDI_SCROLL"]
        options.expandsSubIssues = environment["VERDANDI_EXPAND"] == "1"
        options.signedOut = environment["VERDANDI_SIGNED_OUT"] == "1"
        options.signInToken = environment["VERDANDI_SIGN_IN"].flatMap { $0.isEmpty ? nil : $0 }
        options.clientID = environment["VERDANDI_CLIENT_ID"].flatMap { $0.isEmpty ? nil : $0 }
        options.deviceFlow = environment["VERDANDI_DEVICE_FLOW"].flatMap(DeviceFlowLaunch.init(rawValue:))
        options.goTo = environment["VERDANDI_GO_TO"]
        options.goToSubmits = environment["VERDANDI_GO_TO_SUBMIT"] == "1"
        options.notice = environment["VERDANDI_NOTICE"].flatMap { $0.isEmpty ? nil : $0 }
        options.settingsPage = environment["VERDANDI_SETTINGS"]
        return options
    }

    /// The token GitHub is read with: as the environment and the Keychain
    /// give it, or none for `VERDANDI_SIGNED_OUT`.
    func makeCredentials() -> Credentials {
        guard signedOut else { return Credentials() }
        let credentials = Credentials(environment: [:])
        try? credentials.remove()
        return credentials
    }

    @MainActor
    func apply(to model: AppModel) async {
        if let core = model.core, !track.isEmpty || view != nil {
            if case .ready = (try? await core.checkSetupAgain()) ?? .checking {
                let sidebar = try? await core.getSidebar()
                var entries: SidebarEntries.Read?
                if case .read(let read) = sidebar { entries = read }
                let tracked = entries?.repositories.map(\.repository.address) ?? []
                let missing = track.filter { address in !tracked.contains { $0.sameRepository(as: address) } }
                if !missing.isEmpty { _ = try? await core.addRepositories(missing) }
                if let view, !(entries?.views.contains { $0.view.name == view.name } ?? false) {
                    _ = try? await core.saveView(ViewDraft(name: view.name, query: view.query), force: true)
                }
            }
        }
        if let select { model.select(select) }
        if let issue, let core = model.core {
            if model.selection == nil { model.select(.repository(issue.repository)) }
            if case .found(let found) = try? await core.lookUpIssue(issue.repository, number: issue.number) {
                model.openIssue(IssueRoute(id: found.id, reference: found.reference, title: found.title, url: found.url))
            }
        }
        if let issueId {
            if model.selection == nil { model.select(.all) }
            model.openIssue(IssueRoute(id: issueId, reference: "Issue", title: "An issue opened by its ID"))
        }
        if let sheet { model.sheet = sheet }
    }
}
