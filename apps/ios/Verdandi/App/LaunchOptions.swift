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
struct LaunchOptions {
    var home: URL?
    var select: SidebarItem?
    var issue: (repository: RepositoryAddress, number: Int)?
    var sheet: AppModel.Sheet?
    var appearance: Appearance?

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
        return options
    }

    @MainActor
    func apply(to model: AppModel) async {
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
