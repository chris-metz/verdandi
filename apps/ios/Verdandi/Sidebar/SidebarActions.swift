import SwiftUI
import VerdandiKit

/// A sidebar entry that can move and be removed: a tracked repository or a
/// view. All is fixed.
enum ManagedEntry: Hashable, Identifiable {
    case repository(TrackedRepository)
    case view(SavedView)

    var key: SidebarEntryKey {
        switch self {
        case .repository(let repository): .repository(repository.address)
        case .view(let view): .view(id: view.id)
        }
    }

    var item: SidebarItem {
        switch self {
        case .repository(let repository): .repository(repository.address)
        case .view(let view): .view(id: view.id)
        }
    }

    var id: String {
        switch self {
        case .repository(let repository): "repository:\(repository.address.nameWithOwner.lowercased())"
        case .view(let view): "view:\(view.id)"
        }
    }

    /// What its removal asks, as the desktop's confirmation does.
    var removalTitle: String {
        switch self {
        case .repository(let repository): "Remove \(repository.address.nameWithOwner) from Verdandi?"
        case .view(let view): "Remove the view “\(view.name)”?"
        }
    }

    /// What stays when it is removed.
    var removalMessage: String {
        switch self {
        case .repository: Self.repositoryRemovalMessage
        case .view: Self.viewRemovalMessage
        }
    }

    static let repositoryRemovalMessage =
        "Nothing on GitHub changes. Its issues leave All; views are not changed. You can add it again at any time."
    static let viewRemovalMessage =
        "Its name and search are deleted from your settings. Tracked repositories and issues are not affected. This can’t be undone."
}

/// What the sidebar asks of the core as the user arranges it: moving,
/// removing, tracking a repository's new owner, and recovering the settings
/// file. Whatever cannot be written is told as a notice; the core pushes
/// the sidebar as it changes, so nothing here keeps state of its own.
@MainActor
struct SidebarActions {
    let model: AppModel

    /// The entries as the sidebar lists them, while it can.
    var entries: SidebarEntries.Read? {
        if case .read(let entries) = model.sidebar { return entries }
        return nil
    }

    /// Whether repositories and views can be changed: not while the
    /// settings file is invalid or from a newer Verdandi.
    var canChange: Bool { entries?.settings.isWritable ?? false }

    // MARK: Sheets

    func addRepository() {
        model.sheet = .repositoryPicker
    }

    func newView() {
        model.editedView = nil
        model.duplicatedView = nil
        model.sheet = .newView
    }

    func edit(_ view: SavedView) {
        model.duplicatedView = nil
        model.editedView = view
        model.sheet = .newView
    }

    func duplicate(_ view: SavedView) {
        model.editedView = nil
        model.duplicatedView = view
        model.sheet = .newView
    }

    // MARK: Moving

    /// Moves an entry one place up or down within its section.
    func move(_ entry: ManagedEntry, by step: Int) async {
        guard let core = model.core else { return }
        await write { try await core.reorderSidebar(entry.key, step < 0 ? .up : .down) }
    }

    /// Moves entries of one section as a drag dropped them, at once on
    /// screen, then in the settings file as a move next to the entry it
    /// was dropped by, which holds even if the file changed meanwhile.
    func move(_ keys: [SidebarEntryKey], from source: IndexSet, to destination: Int) async {
        guard let core = model.core, source.count == 1, let from = source.first, keys.indices.contains(from),
            let last = keys.last
        else { return }
        // Dropped where it was.
        if destination == from || destination == from + 1 { return }
        let target: SidebarDestination =
            destination < keys.count
            ? .relative(to: keys[destination], before: true)
            : .relative(to: last, before: false)
        if case .read(var entries) = model.sidebar {
            switch keys[from] {
            case .repository: entries.repositories.move(fromOffsets: source, toOffset: destination)
            case .view: entries.views.move(fromOffsets: source, toOffset: destination)
            }
            model.sidebar = .read(entries)
        }
        await write { try await core.reorderSidebar(keys[from], target) }
    }

    // MARK: Removing

    /// Removes an entry the user confirmed removing.
    @discardableResult
    func remove(_ entry: ManagedEntry) async -> Bool {
        guard let core = model.core else { return false }
        return await write {
            switch entry {
            case .repository(let repository): try await core.removeRepository(repository)
            case .view(let view): try await core.removeView(view.id)
            }
        }
    }

    // MARK: Repositories

    /// **Track the new owner/name**: the repository now at a tracked
    /// repository's name takes its place.
    func trackNew(_ repository: TrackedRepository) async {
        guard let core = model.core else { return }
        do {
            let addition = try await core.replaceRepository(repository)
            switch addition.outcome {
            case .added(let added):
                model.post("Now tracking \(added.repository.nameWithOwner).", systemImage: "checkmark.circle")
            case .unavailable(let found):
                let reason = found.unavailable.map(ReasonText.init) ?? ReasonText(text: "It could not be tracked.")
                model.post("\(found.repository.nameWithOwner): \(reason.text)", systemImage: "exclamationmark.triangle")
            case .failed(let problem):
                let reason = ReasonText(problem, login: model.setup.account?.login, repository: repository.address)
                model.post(reason.text, systemImage: "exclamationmark.triangle")
            }
        } catch {
            model.post(error.localizedDescription, systemImage: "exclamationmark.triangle")
        }
    }

    /// Opens a repository's list and reads what failed of it again.
    func retry(_ repository: RepositoryAddress) async {
        model.select(.repository(repository))
        await model.retry(.list(.repository(repository)))
    }

    // MARK: The settings file

    /// Reads the settings file again, as the user may have fixed it.
    func reloadSettings() async {
        guard let core = model.core else { return }
        do {
            try await core.reloadSettings()
        } catch {
            model.post(error.localizedDescription, systemImage: "exclamationmark.triangle")
        }
    }

    /// Keeps the invalid settings file as a dated backup and starts empty.
    func resetSettings() async {
        guard let core = model.core else { return }
        await write { try await core.resetSettings() }
    }

    /// Runs a change, telling the user why it was not written. A sidebar
    /// moved ahead of the file is read again, so it shows what is stored.
    @discardableResult
    private func write(_ change: () async throws -> ChangeResult) async -> Bool {
        let message: String
        do {
            let result = try await change()
            if result.ok { return true }
            message = result.message ?? "The change could not be saved."
        } catch {
            message = error.localizedDescription
        }
        model.post(message, systemImage: "exclamationmark.triangle")
        if let core = model.core, let sidebar = try? await core.getSidebar() { model.sidebar = sidebar }
        return false
    }
}
