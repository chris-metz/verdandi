import Foundation
import VerdandiKit

/// What a launch for development asks of the app, through environment
/// variables (`SIMCTL_CHILD_…` with `xcrun simctl launch`, as
/// `scripts/run-simulator.sh` passes them), so that a state can be shown and
/// photographed without tapping to it:
///
/// - `VERDANDI_HOME`: another folder for the core's files, e.g. an empty one
///   for a first launch.
/// - `VERDANDI_SELECT`: `all`, `repo:owner/name` or `view:<id>`.
/// - `VERDANDI_ISSUE`: `owner/name#12`, opened over the selected list.
/// - `VERDANDI_SHEET`: `repositoryPicker`, `newView`, `settings` or `goToIssue`.
/// - `VERDANDI_APPEARANCE`: `light` or `dark`, whatever `config.toml` says.
/// - `VERDANDI_TRACK`: `owner/name,owner/name`, tracked unless they are.
/// - `VERDANDI_VIEW`: `Name|search`, saved as a view unless one has the name.
/// - `VERDANDI_BODY`: an HTML file that issue pages show as the issue's body,
///   in place of the one GitHub rendered.
/// - `VERDANDI_LOAD_IMAGES=1`: loads every image from elsewhere than
///   GitHub in bodies at once, as if its placeholder was tapped.
/// - `VERDANDI_BODY_SCROLL`: what the issue page scrolls to once the issue's
///   body shows: a CSS selector of something in it, a number of points, or
///   `sweep`, down a screen a second to the end and back.
/// - `VERDANDI_BODY_TAP`: CSS selectors of what in the issue's body is
///   tapped then, a second apart, separated by `|`, e.g. `img.media-image`.
struct LaunchOptions {
    var home: URL?
    var select: SidebarItem?
    var issue: (repository: RepositoryAddress, number: Int)?
    var sheet: AppModel.Sheet?
    var appearance: Appearance?
    var track: [RepositoryAddress] = []
    var view: (name: String, query: String)?
    var bodyHTML: String?
    var loadsImages = false
    var bodyScroll: String?
    var bodyTap: String?

    /// Whether the launch chooses where the app opens.
    var selects: Bool { select != nil || issue != nil }

    static var current: LaunchOptions {
        let environment = ProcessInfo.processInfo.environment
        var options = LaunchOptions()
        if let home = environment["VERDANDI_HOME"], !home.isEmpty {
            options.home = URL(filePath: home, directoryHint: .isDirectory)
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
        if let body = environment["VERDANDI_BODY"], !body.isEmpty {
            options.bodyHTML = try? String(contentsOfFile: body, encoding: .utf8)
        }
        options.loadsImages = environment["VERDANDI_LOAD_IMAGES"] == "1"
        options.bodyScroll = environment["VERDANDI_BODY_SCROLL"].flatMap { $0.isEmpty ? nil : $0 }
        options.bodyTap = environment["VERDANDI_BODY_TAP"].flatMap { $0.isEmpty ? nil : $0 }
        return options
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
        if let sheet { model.sheet = sheet }
    }
}
