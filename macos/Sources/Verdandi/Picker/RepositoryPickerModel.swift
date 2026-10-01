import Foundation
import Observation
import VerdandiCore

/// How far the picker's suggestions have loaded.
enum SuggestionLoading: Equatable {
  case loading
  case done
  /// Stopped at `RepositoryPickerModel.suggestionCap`; typing an address
  /// still finds the rest.
  case capped
  case failed(GitHubError)
}

/// The repository an address typed in full names, as GitHub was asked.
struct DirectCheck: Equatable {
  enum State: Equatable {
    case checking
    case found(RepositoryAccess)
    case failed(GitHubError)
  }

  var address: RepositoryAddress
  var state: State
}

/// A row of the picker: a repository, and whether it can be added.
struct PickerRow: Identifiable, Equatable {
  enum Status: Equatable {
    case available
    case tracked
    /// It cannot be added, e.g. its issues are turned off.
    case unavailable(String)
    /// The address typed, being looked up.
    case checking
    /// The address typed, not found or not readable.
    case notFound(String)
  }

  var id: String
  var address: RepositoryAddress
  var access: RepositoryAccess?
  var status: Status
  var isChecked: Bool
  /// Whether it is the address typed, rather than a suggestion.
  var isTyped: Bool
  /// The address as typed, which GitHub may have followed elsewhere.
  var typedAddress: RepositoryAddress? = nil

  var isArchived: Bool { access?.isArchived ?? false }

  var canToggle: Bool { status == .available && access != nil }
}

/// A group of the picker's rows: the addresses typed, or one owner's
/// suggestions.
struct PickerSection: Identifiable, Equatable {
  enum Kind: Equatable {
    case typed
    case owner(SuggestionGroup.Kind)
  }

  var id: String
  var title: String
  var kind: Kind
  var rows: [PickerRow]
}

/// What the repository picker holds: the suggestions as they load, page by
/// page, the address typed and what GitHub says of it, and the
/// repositories checked to be added.
@Observable
final class RepositoryPickerModel {
  /// At most this many suggestions load, ten pages of GitHub's.
  static let suggestionCap = 1000

  var text: String
  /// The owner whose suggestions show, or all of them.
  var ownerFilter: String?
  /// The row the keyboard is on.
  var highlighted: PickerRow.ID?

  private(set) var account: String?
  private(set) var organizations: [String] = []
  private(set) var suggestions: [RepositoryAccess] = []
  private(set) var loading: SuggestionLoading = .loading
  private(set) var direct: DirectCheck?
  /// The repositories checked to be added, in the order checked.
  private(set) var selected: [RepositoryAccess] = []
  /// What GitHub said of each address typed so far.
  @ObservationIgnored private var checked: [RepositoryAddress: DirectCheck.State] = [:]

  init(text: String = "") {
    self.text = text
  }

  // MARK: Loading

  /// Loads the suggestions page after page, each one shown as it comes,
  /// up to `suggestionCap`.
  func loadSuggestions(with client: GitHubClient) async {
    var after: String?
    loading = .loading
    repeat {
      do {
        let page = try await client.repositorySuggestions(after: after)
        if after == nil {
          account = page.account
          organizations = page.organizations ?? []
        }
        let known = Set(suggestions.map(\.id))
        suggestions += page.repositories.filter { !known.contains($0.id) }
        after = page.nextPage
      } catch {
        loading = .failed(error)
        return
      }
      if suggestions.count >= Self.suggestionCap, after != nil {
        loading = .capped
        return
      }
    } while after != nil && !Task.isCancelled
    loading = .done
  }

  /// The address typed in full, if the text is one.
  var typedAddress: RepositoryAddress? { RepositoryAddress.fromInput(text) }

  /// Asks GitHub about the address typed, once typing pauses, unless it is
  /// suggested or was asked about before.
  func checkTypedAddress(with client: GitHubClient) async {
    guard let address = typedAddress, !suggestions.contains(where: { $0.repository == address }) else {
      direct = nil
      return
    }
    if let state = checked[address] {
      direct = DirectCheck(address: address, state: state)
      return
    }
    direct = DirectCheck(address: address, state: .checking)
    do {
      try await Task.sleep(for: .milliseconds(250))
    } catch {
      return
    }
    let state: DirectCheck.State
    do {
      switch try await client.repositoryAccess([address]).first {
      case .success(let access): state = .found(access)
      case .failure(let error): state = .failed(error)
      case nil: state = .failed(.unexpectedResponse)
      }
    } catch {
      state = .failed(error)
    }
    if !state.isTransient { checked[address] = state }
    if direct?.address == address { direct = DirectCheck(address: address, state: state) }
  }

  // MARK: Rows

  /// The owners whose suggestions loaded, in the order the picker lists
  /// them.
  var owners: [SuggestionGroup] {
    groupSuggestions(suggestions, account: account ?? "", organizations: organizations)
  }

  /// The rows as the picker lists them: the address typed and repositories
  /// checked that are not suggested first, then each owner's suggestions
  /// that match the text.
  func sections(tracked: [TrackedRepository]) -> [PickerSection] {
    let selectedIds = Set(selected.map(\.id))
    func row(_ access: RepositoryAccess, typed: Bool) -> PickerRow {
      let candidate = TrackedRepository(address: access.repository, githubId: access.id)
      let isTracked = tracked.contains { $0.isSame(as: candidate) }
      let status: PickerRow.Status =
        if isTracked { .tracked }
        else if let reason = access.unavailableReason { .unavailable(reason) }
        else { .available }
      return PickerRow(
        id: "\(access.id)", address: access.repository, access: access, status: status,
        isChecked: isTracked || selectedIds.contains(access.id), isTyped: typed)
    }

    var typedRows: [PickerRow] = []
    let suggestedIds = Set(suggestions.map(\.id))
    if let direct, direct.address == typedAddress {
      switch direct.state {
      case .checking:
        typedRows.append(
          PickerRow(
            id: "typed:\(direct.address)", address: direct.address, status: .checking, isChecked: false, isTyped: true))
      case .found(let access):
        var found = row(suggestions.first { $0.id == access.id } ?? access, typed: true)
        found.typedAddress = direct.address
        typedRows.append(found)
      case .failed(let error):
        let message =
          if case .unavailable = error { "Not found, or not readable with this account." } else { error.message }
        typedRows.append(
          PickerRow(
            id: "typed:\(direct.address)", address: direct.address, status: .notFound(message), isChecked: false,
            isTyped: true))
      }
    }
    // Repositories checked earlier by their address stay in sight.
    for access in selected where !suggestedIds.contains(access.id) {
      if !typedRows.contains(where: { $0.id == "\(access.id)" }) { typedRows.append(row(access, typed: true)) }
    }

    var sections: [PickerSection] = []
    if !typedRows.isEmpty {
      sections.append(PickerSection(id: "typed", title: "Typed", kind: .typed, rows: typedRows))
    }
    let shown = Set(typedRows.map(\.id))
    for group in groupSuggestions(suggestions, account: account ?? "", organizations: organizations, matching: text) {
      if let ownerFilter, group.owner.lowercased() != ownerFilter.lowercased() { continue }
      let rows = group.repositories.map { row($0, typed: false) }.filter { !shown.contains($0.id) }
      guard !rows.isEmpty else { continue }
      sections.append(PickerSection(id: group.id, title: group.owner, kind: .owner(group.kind), rows: rows))
    }
    return sections
  }

  // MARK: Choosing

  /// Checks a row, or unchecks it, unless it cannot be added.
  func toggle(_ row: PickerRow) {
    guard row.canToggle, let access = row.access else { return }
    if let index = selected.firstIndex(where: { $0.id == access.id }) {
      selected.remove(at: index)
    } else {
      selected.append(access)
    }
  }

  /// Moves the keyboard's row by `step` among `rows`.
  func moveHighlight(by step: Int, in rows: [PickerRow]) {
    guard !rows.isEmpty else { return }
    let current = rows.firstIndex { $0.id == highlighted }
    let next = current.map { min(max($0 + step, 0), rows.count - 1) } ?? (step > 0 ? 0 : rows.count - 1)
    highlighted = rows[next].id
  }

  /// What Add adds: the repositories checked, or else the row the keyboard
  /// is on, or the address typed, if it can be added.
  func chosen(in rows: [PickerRow]) -> [RepositoryAccess] {
    if !selected.isEmpty { return selected }
    let row = highlighted.map { id in rows.first { $0.id == id } } ?? rows.first { $0.isTyped }
    guard let row, row.canToggle, let access = row.access else { return [] }
    return [access]
  }
}

extension DirectCheck.State {
  /// Whether asking again later may answer otherwise, e.g. offline.
  var isTransient: Bool {
    if case .failed(let error) = self { return error.isTransient }
    return false
  }
}
