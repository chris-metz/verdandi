import Foundation
import VerdandiCore

extension IssueListModel {
  /// The list's title: All, the repository's name, or the view's.
  var title: String {
    switch item {
    case .all: "All"
    case .repository(let address): address.name
    case .view: view?.name ?? "View"
    }
  }

  /// The counts under the title, e.g. "1,042 open · 3 matching", once
  /// something has loaded; a view's "12 matches".
  func subtitle(_ forest: Forest) -> String {
    guard hasLoaded else { return "" }
    let scope = forest.scopeCount.formatted()
    let matching = labelFilter.isEmpty ? "" : " · \(forest.matchCount.formatted()) matching"
    if isView {
      let total = run.map { max($0.total - $0.pullRequests, forest.scopeCount) } ?? forest.scopeCount
      let found = "\(total.formatted()) \(total == 1 ? "match" : "matches")"
      return labelFilter.isEmpty ? found : "\(found)\(matching)"
    }
    return "\(scope) \(state.rawValue)\(matching)"
  }

  /// The status line: how far the list has loaded and how current it is,
  /// then what of it could not be read.
  func status(_ forest: Forest, now: Date) -> String {
    var parts: [String] = []
    if let searching {
      if let pages = searching.pages, pages > 1 {
        parts.append("Searching… page \(searching.page) of \(pages)")
      } else {
        parts.append("Searching…")
      }
    } else if isLoading {
      let verb = hasLoaded && !loads.contains(where: { !$0.hasLoaded }) ? "Updating" : "Loading"
      let (loaded, total) = pageProgress
      if let total, total > 1 {
        parts.append("\(verb) \(min(loaded + 1, total)) of \(total) pages…")
      } else {
        parts.append("\(verb)…")
      }
    } else if pendingReads > 0 {
      parts.append("Loading parent issues and sub-issues…")
    } else if let updatedAt {
      parts.append(Self.updated(updatedAt, now: now))
    }
    parts += problemNotes(forest)
    return parts.joined(separator: " · ")
  }

  /// Whether the status line offers to read again what could not be read.
  func canRetry(_ forest: Forest) -> Bool {
    !isBusy && !problemNotes(forest).isEmpty
  }

  /// What could not be read: repositories or the search, and issues the
  /// forest names, counting those GitHub does not show apart.
  func problemNotes(_ forest: Forest) -> [String] {
    var notes: [String] = []
    let problems = problems
    if problems.count == 1, let problem = problems.first {
      notes.append(
        problem.error.isUnavailable ? "\(problem.subject) unavailable" : "\(problem.subject) could not be loaded")
    } else if problems.count > 1 {
      notes.append("\(problems.count) repositories could not be loaded")
    }
    var unavailable = 0
    var failed = 0
    let unread = forest.allNodes.compactMap(\.unread) + forest.trees.compactMap { $0.parent?.unread }
    for case .failed(let error) in unread {
      if error.isUnavailable { unavailable += 1 } else { failed += 1 }
    }
    if unavailable > 0 { notes.append("\(unavailable) \(unavailable == 1 ? "issue" : "issues") not visible") }
    if failed > 0 { notes.append("\(failed) \(failed == 1 ? "issue" : "issues") could not be loaded") }
    return notes
  }

  /// How long ago data was read: just now within the first minute, then
  /// whole minutes, then whole hours.
  static func updated(_ date: Date, now: Date) -> String {
    let minutes = Int(now.timeIntervalSince(date) / 60)
    if minutes < 1 { return "Updated just now" }
    if minutes < 60 { return "Updated \(minutes) min ago" }
    return "Updated \(minutes / 60) h ago"
  }
}

extension GitHubError {
  /// Whether GitHub would not show it to this account.
  fileprivate var isUnavailable: Bool {
    if case .unavailable = self { return true }
    return false
  }
}
