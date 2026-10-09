import SwiftUI
import VerdandiKit

/// A repository checked by the exact address typed into the picker.
enum DirectCheck: Equatable {
    case checking(RepositoryAddress)
    case done(RepositoryAddress, RepositoryCheck)

    var repository: RepositoryAddress {
        switch self {
        case .checking(let repository), .done(let repository, _): repository
        }
    }
}

/// A row of the picker: a repository it suggests or was typed, as far as
/// it can be selected.
struct PickerRow: Identifiable, Equatable {
    var id: String
    /// The repository as the row names it.
    var repository: RepositoryAddress
    /// What adding the row adds, once it was found.
    var candidate: PickerRepository?
    var checked: Bool
    /// Whether it cannot be toggled: tracked, unavailable, or being checked.
    var disabled: Bool
    var archived: Bool
    var tracked: Bool
    var checking: Bool
    var note: ReasonText?
    /// Whether the note says what went wrong, rather than what it is.
    var failed: Bool
}

/// The picker's rows, in two parts: what was typed, then the suggestions.
struct PickerRows: Equatable {
    /// The exact address typed, while it is not suggested, then the
    /// repositories selected that are not suggested, such as addresses typed
    /// before, so that each stays in sight with why it could not be added.
    var typed: [PickerRow] = []
    /// The selected owner's suggestions whose `owner/name` holds the text.
    var suggested: [PickerRow] = []

    var isEmpty: Bool { typed.isEmpty && suggested.isEmpty }
}

/// What the repository picker holds while it is open, as the desktop's
/// `repository-picker.ts` does: the text typed, the owner chosen, the
/// repositories selected, the exact addresses checked, and why those that
/// could not be added were not. The suggestions come from the core.
@MainActor @Observable
final class RepositoryPickerModel {
    enum Busy { case adding, skipping }

    var text: String
    /// The owner whose suggestions show, or every suggestion.
    var owner: String?
    /// The repositories checked to be added, in the order checked.
    private(set) var selected: [PickerRepository] = []
    /// Why a repository could not be added, by ID.
    private(set) var errors: [Int: ReasonText] = [:]
    /// The exact addresses checked, by `owner/name` in lower case.
    private(set) var checks: [String: DirectCheck] = [:]
    /// The repositories added while the picker is open, tracked now, by ID.
    private(set) var added: [Int: PickerRepository] = [:]
    var busy: Busy?
    /// Why adding or skipping failed as a whole.
    var failure: String?

    init(text: String = "") {
        self.text = text
    }

    /// The address the text names exactly, `owner/name` or a link.
    var typedAddress: RepositoryAddress? { RepositoryAddress(parsing: text) }

    func isSelected(_ id: Int) -> Bool { selected.contains { $0.id == id } }

    // MARK: Rows

    func rows(_ suggestions: [PickerRepository], login: String?) -> PickerRows {
        let typed = typedAddress
        let needle = (typed?.nameWithOwner ?? text.trimmingCharacters(in: .whitespacesAndNewlines)).lowercased()
        let suggestedIDs = Set(suggestions.map(\.id))
        var rows = PickerRows()
        var shown = Set<Int>()

        func take(_ repository: PickerRepository) -> PickerRow? {
            guard shown.insert(repository.id).inserted else { return nil }
            return self.row(added[repository.id] ?? repository)
        }

        if let typed, let check = checks[Self.key(typed)],
            !suggestions.contains(where: { $0.repository.sameRepository(as: typed) })
        {
            if case .done(_, .found(let found)) = check {
                // An old address of a suggested repository shows the suggestion.
                let suggestion = suggestions.first { $0.id == found.id }
                if let row = take(suggestion ?? found) { rows.typed.append(row) }
            } else {
                var note = ReasonText(text: "Checking…")
                if case .done(_, .failed(let problem)) = check { note = ReasonText(problem, login: login) }
                let checking = if case .checking = check { true } else { false }
                rows.typed.append(
                    PickerRow(
                        id: "direct:\(needle)", repository: check.repository, candidate: nil, checked: false,
                        disabled: true, archived: false, tracked: false, checking: checking, note: note,
                        failed: !checking))
            }
        }
        for repository in selected where !suggestedIDs.contains(repository.id) {
            if let row = take(repository) { rows.typed.append(row) }
        }
        for repository in suggestions {
            if let owner, repository.repository.owner.lowercased() != owner.lowercased() { continue }
            if !needle.isEmpty, !repository.repository.nameWithOwner.lowercased().contains(needle) { continue }
            if let row = take(repository) { rows.suggested.append(row) }
        }
        return rows
    }

    /// A found repository's row, as far as it can be selected.
    private func row(_ repository: PickerRepository) -> PickerRow {
        var row = PickerRow(
            id: String(repository.id), repository: repository.repository, candidate: repository, checked: false,
            disabled: false, archived: repository.archived, tracked: repository.tracked, checking: false, note: nil,
            failed: false)
        if repository.tracked {
            row.checked = true
            row.disabled = true
            row.note = ReasonText(text: "Tracked")
        } else if let unavailable = repository.unavailable {
            row.disabled = true
            row.note = ReasonText(unavailable)
        } else {
            row.checked = isSelected(repository.id)
            row.note = errors[repository.id]
            row.failed = row.note != nil
        }
        return row
    }

    // MARK: Choosing

    /// Checks a row, or unchecks it, unless it cannot be toggled.
    func toggle(_ row: PickerRow) {
        guard !row.disabled, let candidate = row.candidate else { return }
        errors[candidate.id] = nil
        if isSelected(candidate.id) {
            selected.removeAll { $0.id == candidate.id }
        } else {
            selected.append(candidate)
        }
    }

    /// Checks those of the repositories named that are suggested, once
    /// each, as a launch for development asks.
    func check(_ repositories: [RepositoryAddress], in suggestions: [PickerRepository]) {
        for address in repositories where !launchChecked.contains(address.nameWithOwner.lowercased()) {
            guard let suggestion = suggestions.first(where: { $0.repository.sameRepository(as: address) }),
                !suggestion.tracked, suggestion.unavailable == nil
            else { continue }
            launchChecked.insert(address.nameWithOwner.lowercased())
            if !isSelected(suggestion.id) { selected.append(suggestion) }
        }
    }

    @ObservationIgnored private var launchChecked = Set<String>()

    /// Checks the exact address typed once typing pauses, unless it is
    /// suggested by that name. Each address is checked once while the picker
    /// is open; one whose check failed is checked again when typed again.
    func checkTyped(_ suggestions: [PickerRepository], with core: Core) async {
        guard let typed = typedAddress,
            !suggestions.contains(where: { $0.repository.sameRepository(as: typed) })
        else { return }
        let key = Self.key(typed)
        if let known = checks[key], !Self.failed(known) { return }
        do {
            try await Task.sleep(for: .milliseconds(300))
        } catch {
            return
        }
        checks[key] = .checking(typed)
        let check: RepositoryCheck
        do {
            check = try await core.checkRepository(typed)
        } catch {
            check = .failed(.error(message: error.localizedDescription))
        }
        checks[key] = .done(typed, check)
        // An exact address is typed to be added: it is checked at once.
        if case .found(let found) = check, !found.tracked, found.unavailable == nil, !isSelected(found.id) {
            selected.append(found)
        }
    }

    // MARK: Adding

    /// Adds the repositories checked. Those added leave the selection; the
    /// rest stay selected, each with why it could not be added. Returns
    /// those added, or none when adding failed as a whole.
    func add(with core: Core, login: String?) async -> [PickerRepository] {
        let chosen = selected
        guard busy == nil, !chosen.isEmpty else { return [] }
        busy = .adding
        failure = nil
        defer { busy = nil }
        let additions: [RepositoryAddition]
        do {
            additions = try await core.addRepositories(chosen.map(\.repository))
        } catch {
            failure = error.localizedDescription
            return []
        }
        var addedNow: [PickerRepository] = []
        for (index, repository) in chosen.enumerated() {
            let outcome = additions[safe: index]?.outcome
            switch outcome {
            case .added(var tracked)?:
                tracked.tracked = true
                added[repository.id] = tracked
                addedNow.append(tracked)
                selected.removeAll { $0.id == repository.id }
                errors[repository.id] = nil
            case .unavailable(let found)?:
                errors[repository.id] =
                    found.unavailable.map(ReasonText.init) ?? ReasonText(text: "It could not be added.")
            case .failed(let problem)?:
                errors[repository.id] = ReasonText(problem, login: login)
            case nil:
                errors[repository.id] = ReasonText(text: "It could not be added.")
            }
        }
        return addedNow
    }

    /// **Skip** on the first launch: the settings file is created empty, so
    /// that the picker does not open on its own again.
    func skip(with core: Core) async -> Bool {
        guard busy == nil else { return false }
        busy = .skipping
        failure = nil
        defer { busy = nil }
        do {
            let result = try await core.skipRepositoryPicker()
            if result.ok { return true }
            failure = result.message ?? "The settings file could not be created."
        } catch {
            failure = error.localizedDescription
        }
        return false
    }

    private static func key(_ repository: RepositoryAddress) -> String {
        repository.nameWithOwner.lowercased()
    }

    private static func failed(_ check: DirectCheck) -> Bool {
        if case .done(_, .failed) = check { return true }
        return false
    }
}
