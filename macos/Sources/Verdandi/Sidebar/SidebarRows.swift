import SwiftUI
import VerdandiCore

/// All: every tracked repository at once, with their open issues together.
struct AllRow: View {
  @Environment(AppModel.self) private var model
  var shortcut: Int?

  var body: some View {
    HStack {
      Label("All", systemImage: "square.stack.3d.up")
      Spacer(minLength: 6)
      EntryAccessory(shortcut: shortcut) {
        if let count = model.sidebar.allCount { CountText(count: count) }
      }
    }
  }
}

/// A tracked repository: its name, its owner below, and its open issues,
/// or why they cannot be shown.
struct RepositoryRow: View {
  @Environment(AppModel.self) private var model
  var repository: TrackedRepository
  var shortcut: Int?

  var body: some View {
    let summary = model.sidebar.summaries[repository.address]
    let status = RepositoryStatus(summary: summary, problem: model.sidebar.problems[repository.address])
    HStack {
      Label {
        VStack(alignment: .leading, spacing: 0) {
          Text(repository.address.name)
            .lineLimit(1)
          Text(repository.address.owner)
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      } icon: {
        Image(systemName: status.symbol)
          .foregroundStyle(status.tint ?? .accentColor)
          .contentTransition(.symbolEffect(.replace))
      }
      Spacer(minLength: 6)
      EntryAccessory(shortcut: shortcut) {
        if let summary, status.showsCount { CountText(count: summary.openIssueCount) }
      }
    }
    .help(ifAny: status.help)
    .accessibilityElement(children: .combine)
    .accessibilityValue(status.accessibilityValue(count: summary?.openIssueCount))
  }
}

/// Whether a tracked repository's issues can be shown, and how its row says
/// so: the icon stands for what is wrong, the tooltip says why.
struct RepositoryStatus {
  enum Kind {
    case loading
    case available
    case archived
    case issuesDisabled
    case unavailable(GitHubError)
  }

  var kind: Kind

  init(summary: RepositorySummary?, problem: GitHubError?) {
    kind =
      if let problem { .unavailable(problem) }
      else if let summary, !summary.hasIssuesEnabled { .issuesDisabled }
      else if let summary, summary.isArchived { .archived }
      else if summary != nil { .available }
      else { .loading }
  }

  var symbol: String {
    switch kind {
    case .loading, .available: "book.closed"
    case .archived: "archivebox"
    case .issuesDisabled: "nosign"
    case .unavailable: "exclamationmark.triangle.fill"
    }
  }

  var tint: Color? {
    switch kind {
    case .loading, .available: nil
    case .archived, .issuesDisabled: .secondary
    case .unavailable: .orange
    }
  }

  var showsCount: Bool {
    switch kind {
    case .available, .archived: true
    default: false
    }
  }

  var help: String? {
    switch kind {
    case .loading, .available: nil
    case .archived: "Archived on GitHub: its issues can be read, not changed."
    case .issuesDisabled: "Issues are turned off for this repository."
    case .unavailable(let error): error.message
    }
  }

  func accessibilityValue(count: Int?) -> String {
    let issues = count.map { "\($0) open issues" }
    return [issues, help].compactMap { $0 }.joined(separator: ", ")
  }
}

/// A view: its name and how many issues its search matches.
struct ViewRow: View {
  @Environment(AppModel.self) private var model
  var view: SavedView
  var shortcut: Int?

  var body: some View {
    let count = model.sidebar.matchCounts[view.query]
    HStack {
      Label {
        Text(view.name).lineLimit(1)
      } icon: {
        Image(systemName: isRejected(count) ? "exclamationmark.triangle.fill" : "line.3.horizontal.decrease.circle")
          .foregroundStyle(isRejected(count) ? AnyShapeStyle(.orange) : AnyShapeStyle(.tint))
          .contentTransition(.symbolEffect(.replace))
      }
      Spacer(minLength: 6)
      EntryAccessory(shortcut: shortcut) {
        if case .known(let total, _) = count { CountText(count: total, compact: true) }
      }
    }
    .help(help(count))
    .accessibilityElement(children: .combine)
  }

  private func isRejected(_ count: MatchCount?) -> Bool {
    if case .rejected = count { return true }
    return false
  }

  private func help(_ count: MatchCount?) -> String {
    switch count {
    case .known(let total, let incomplete):
      "\(view.query)\n\(total.formatted()) matches\(incomplete ? ", GitHub did not search everything in time" : "")"
    case .rejected(let message): "GitHub rejected the search: \(message)"
    case .failed(let error): "The matches could not be counted: \(error.message)"
    case nil: view.query
    }
  }
}

/// The trailing end of an entry: its count, or its ⌘ shortcut while ⌘ is
/// held.
struct EntryAccessory<Count: View>: View {
  var shortcut: Int?
  @ViewBuilder var count: Count

  var body: some View {
    ZStack(alignment: .trailing) {
      if let shortcut {
        Text("⌘\(shortcut)")
          .font(.caption.weight(.medium))
          .monospacedDigit()
          .foregroundStyle(.secondary)
          .padding(.horizontal, 5)
          .padding(.vertical, 1)
          .background(.quaternary, in: .rect(cornerRadius: 5, style: .continuous))
          .transition(.blurReplace)
      } else {
        count.transition(.blurReplace)
      }
    }
  }
}

/// A count as the sidebar shows it, rolling to its new value as it changes.
struct CountText: View {
  var count: Int
  /// Abbreviated, e.g. 4.2K, as views may match many.
  var compact = false

  var body: some View {
    Group {
      if compact {
        Text(count, format: .number.notation(.compactName))
      } else {
        Text(count, format: .number)
      }
    }
    .font(.subheadline)
    .monospacedDigit()
    .foregroundStyle(.secondary)
    .contentTransition(.numericText(value: Double(count)))
    .animation(.smooth, value: count)
  }
}

extension View {
  /// A tooltip, when there is something to say.
  @ViewBuilder
  fileprivate func help(ifAny text: String?) -> some View {
    if let text { help(text) } else { self }
  }
}
