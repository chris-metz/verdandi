import UIKit
import VerdandiKit

/// What a launch for development asks of the sidebar and its sheets, beside
/// `LaunchOptions`, so that their states can be shown and photographed
/// without tapping to them:
///
/// - `VERDANDI_RATE_LIMITS=open`: the rate-limit popover opens.
/// - `VERDANDI_EDIT_VIEW=<name>`: the view editor edits the view of that name.
/// - `VERDANDI_DUPLICATE_VIEW=<name>`: the view editor duplicates it.
/// - `VERDANDI_DRAFT=Name|search`: a new view's fields start so.
/// - `VERDANDI_SAVE=1`: the view editor saves at once, to show what
///   becomes of it.
/// - `VERDANDI_REMOVE=repo:owner/name` or `view:<name>`: its removal asks
///   to be confirmed.
/// - `VERDANDI_PICKER_SEARCH=<text>`: the repository picker's search.
/// - `VERDANDI_PICKER_SELECT=owner/name,owner/name`: the picker checks
///   these once it suggests them.
/// - `VERDANDI_PICKER_ADD=1`: and then adds them, to show what becomes of it.
/// - `VERDANDI_SIDEBAR=shown`: the sidebar shows, also on an iPad in
///   portrait and on an iPhone that would show a list.
enum SidebarLaunchOptions {
    private static var environment: [String: String] { ProcessInfo.processInfo.environment }

    static var opensRateLimits: Bool { environment["VERDANDI_RATE_LIMITS"] == "open" }
    static var editedViewName: String? { environment["VERDANDI_EDIT_VIEW"] }
    static var duplicatedViewName: String? { environment["VERDANDI_DUPLICATE_VIEW"] }
    static var savesAtOnce: Bool { environment["VERDANDI_SAVE"] == "1" }
    static var pickerSearch: String { environment["VERDANDI_PICKER_SEARCH"] ?? "" }
    static var pickerAddsAtOnce: Bool { environment["VERDANDI_PICKER_ADD"] == "1" }
    static var pickerSelection: [RepositoryAddress] {
        (environment["VERDANDI_PICKER_SELECT"] ?? "").split(separator: ",").compactMap {
            RepositoryAddress(parsing: String($0))
        }
    }

    static var draft: (name: String, query: String)? {
        guard let draft = environment["VERDANDI_DRAFT"], let bar = draft.firstIndex(of: "|") else { return nil }
        return (String(draft[..<bar]), String(draft[draft.index(after: bar)...]))
    }

    /// Whether the launch asks for the sidebar to show: an iPad in portrait
    /// hides it at first, and an iPhone shows the chosen entry's list over it.
    static var showsSidebar: Bool { environment["VERDANDI_SIDEBAR"] == "shown" }

    /// Goes back to the sidebar on an iPhone as the launch asks, as its Back
    /// button would.
    @MainActor
    static func showSidebar(_ model: AppModel) async {
        guard showsSidebar, UIDevice.current.userInterfaceIdiom == .phone else { return }
        try? await Task.sleep(for: .seconds(1))
        model.select(nil)
    }

    /// The entry whose removal the launch asks to confirm, once the sidebar
    /// lists it.
    static func removal(in entries: SidebarEntries.Read) -> ManagedEntry? {
        guard let removal = environment["VERDANDI_REMOVE"] else { return nil }
        if removal.hasPrefix("repo:"), let address = RepositoryAddress(parsing: String(removal.dropFirst(5))) {
            return entries.repositories.first { $0.repository.address.sameRepository(as: address) }
                .map { .repository($0.repository) }
        }
        if removal.hasPrefix("view:") {
            let name = removal.dropFirst(5)
            return entries.views.first { $0.view.name == name }.map { .view($0.view) }
        }
        return nil
    }

    /// Opens the view editor as the launch asks, once the sidebar lists the
    /// view.
    @MainActor
    static func openEditor(in entries: SidebarEntries.Read, with actions: SidebarActions) {
        if let name = editedViewName, let entry = entries.views.first(where: { $0.view.name == name }) {
            actions.edit(entry.view)
        } else if let name = duplicatedViewName, let entry = entries.views.first(where: { $0.view.name == name }) {
            actions.duplicate(entry.view)
        }
    }
}
