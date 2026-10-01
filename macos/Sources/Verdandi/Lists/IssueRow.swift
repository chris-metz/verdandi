import AppKit
import SwiftUI
import VerdandiCore

/// One issue of a list, in two lines as Mail shows a message: its state and
/// title, with who opened it and when; below, its reference, labels and how
/// it relates to other issues.
///
/// An issue that has not been read shows as its parent issue names it, with
/// why. Context issues are dimmed, as are, in a list without a label filter,
/// issues in the other state than the list's.
struct IssueRow: View {
  /// The issue, without its sub-issues, which rows of their own show.
  var node: ForestNode
  /// How the list names repositories in references.
  var naming: RepositoryNaming
  /// The state of the list it stands in; none in a view.
  var listState: IssueState?
  var list: IssueListModel

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        RowStateIcon(state: node.issue?.state ?? node.reference.state)
          .frame(width: Self.iconWidth)
        Text(node.issue?.title ?? node.reference.title)
          .lineLimit(1)
          .foregroundStyle(node.unread == nil ? .primary : .secondary)
        Spacer(minLength: 6)
        if let issue = node.issue {
          AgeLabel(issue: issue, closedList: listState == .closed)
          AvatarView(actor: issue.author, size: 16)
            .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
            .help(issue.author.map { "Opened by @\($0.login)" } ?? "Opened by a deleted account")
        }
      }
      HStack(spacing: 5) {
        ReferenceText(node: node, naming: naming)
        if let unread = node.unread {
          UnreadNote(unread: unread)
        }
        if let parent = node.parent {
          ParentChip(parent: parent, naming: naming)
        }
        if let missingParent = node.missingParent {
          MissingParentChip(unread: missingParent)
        }
        if !node.isExpanded, let inside = node.mark?.matchesInside, inside > 0 {
          InsideChip(count: inside)
        }
        if let issue = node.issue {
          RowLabels(labels: issue.labels) { label in withAnimation(.bouncy) { list.addLabel(label) } }
          Spacer(minLength: 4)
          RelationshipBadges(issue: issue)
            .opacity(stateDimmed ? 1 / Self.dimmed : 1)
        }
      }
      .font(.caption)
      // As tall with labels as without, so that rows line up as Mail's do.
      .frame(minHeight: 16)
      .padding(.leading, Self.iconWidth + 6)
    }
    .padding(.vertical, 3)
    .opacity(isDimmed ? Self.dimmed : 1)
    .help(markHelp)
    .contextMenu { RowMenu(node: node, list: list) }
    .accessibilityElement(children: .combine)
  }

  static let iconWidth: CGFloat = 16
  static let dimmed = 0.5

  /// Whether it is a context issue, where issues are marked.
  private var isContext: Bool { node.mark.map { !$0.isMatch } ?? false }

  /// Whether, unmarked, it is in the other state than the list's: a closed
  /// issue in an open list, an open one in a closed list.
  private var stateDimmed: Bool {
    guard node.mark == nil, let listState, let issue = node.issue else { return false }
    return issue.state != listState
  }

  private var isDimmed: Bool { isContext || stateDimmed }

  /// Why a context issue shows, for its tooltip; matches need no word.
  private var markHelp: Text {
    guard let mark = node.mark, !mark.isMatch else { return Text(verbatim: "") }
    if mark.mayMatch { return Text("Context issue: the search results are incomplete, so it may match too") }
    return Text("Context issue: shown for its place in the tree")
  }
}

/// `#12`, `name#12` or `owner/name#12`, as the list names its repository;
/// outlined for an issue outside every tracked repository.
private struct ReferenceText: View {
  var node: ForestNode
  var naming: RepositoryNaming

  var body: some View {
    let reference = node.reference
    HStack(spacing: 1) {
      Text(naming.name(reference))
      if node.mark?.mayMatch == true {
        Text("?").fontWeight(.semibold).help("May match: the search results are incomplete")
      }
    }
    .monospacedDigit()
    .foregroundStyle(.secondary)
    .lineLimit(1)
    .padding(.horizontal, node.isExternal ? 5 : 0)
    .overlay {
      if node.isExternal {
        Capsule().strokeBorder(.tertiary, style: StrokeStyle(lineWidth: 0.75, dash: [2, 2]))
      }
    }
    .help(node.isExternal ? "\(reference.repository) is not a tracked repository" : reference.qualifiedReference)
    .layoutPriority(2)
  }
}

/// How long ago an issue was opened, or closed in a closed list, as `5m`,
/// `3h`, `2d`, `4mo` or `1y`.
private struct AgeLabel: View {
  var issue: Issue
  var closedList: Bool

  var body: some View {
    let closed = closedList ? issue.closedAt : nil
    let date = closed ?? issue.createdAt
    Text(Self.age(of: date, now: .now))
      .font(.caption)
      .monospacedDigit()
      .foregroundStyle(.secondary)
      .help("\(closed == nil ? "Opened" : "Closed") \(date.formatted(date: .abbreviated, time: .shortened))")
  }

  static func age(of date: Date, now: Date) -> String {
    let seconds = now.timeIntervalSince(date)
    let units: [(TimeInterval, String)] = [
      (365 * 86400, "y"), (30 * 86400, "mo"), (7 * 86400, "w"), (86400, "d"), (3600, "h"), (60, "m"),
    ]
    for (size, unit) in units where seconds >= size {
      return "\(Int(seconds / size))\(unit)"
    }
    return "now"
  }
}

/// Why a row shows an issue only as its parent issue names it.
private struct UnreadNote: View {
  var unread: UnreadIssue

  var body: some View {
    switch unread {
    case .loading:
      HStack(spacing: 4) {
        ProgressView().controlSize(.mini)
        Text("Loading…")
      }
      .foregroundStyle(.secondary)
    case .failed(.unavailable(let message)):
      Label("Not visible to you", systemImage: "lock.fill")
        .foregroundStyle(.secondary)
        .help(message)
    case .failed(let error):
      Label("Could not be loaded", systemImage: "exclamationmark.triangle.fill")
        .foregroundStyle(.orange)
        .help(error.message)
    }
  }
}

/// How a list names an issue's repository in its reference: not at all for
/// its own repository's issues, by name for a tracked repository whose name
/// no other tracked repository shares, otherwise as `owner/name`.
struct RepositoryNaming: Equatable {
  /// The repository whose list it is, if it is one's.
  var own: RepositoryAddress?
  var tracked: [RepositoryAddress]

  func name(_ reference: IssueReference) -> String {
    let repository = reference.repository
    if repository == own { return "#\(reference.number)" }
    let named = tracked.filter { $0.name.lowercased() == repository.name.lowercased() }
    if named == [repository] { return "\(repository.name)#\(reference.number)" }
    return reference.qualifiedReference
  }
}

/// An issue's open or closed icon in GitHub's colours, white on a selected
/// row, where colours would not stand out.
private struct RowStateIcon: View {
  @Environment(\.backgroundProminence) private var prominence
  var state: IssueState

  var body: some View {
    Image(systemName: state == .open ? "circle.circle" : "checkmark.circle")
      .foregroundStyle(prominence == .increased ? Color.white : Color.issueState(state))
      .accessibilityLabel(state == .open ? "Open" : "Closed")
  }
}

/// A label as GitHub colours it, small enough for a row, its name lighter in
/// the dark so that dark labels still read; on a selected row a white
/// outline, which reads on any selection colour.
private struct RowLabelChip: View {
  @Environment(\.backgroundProminence) private var prominence
  @Environment(\.colorScheme) private var colorScheme
  var label: VerdandiCore.Label

  var body: some View {
    let color = Color(hex: label.color)
    let selected = prominence == .increased
    let dark = colorScheme == .dark
    Text(label.name)
      .font(.caption2.weight(.medium))
      .lineLimit(1)
      .padding(.horizontal, 6)
      .padding(.vertical, 1)
      .foregroundStyle(selected ? .white : color.mix(with: dark ? .white : .black, by: dark ? 0.45 : 0.35))
      .background(selected ? .white.opacity(0.18) : color.opacity(dark ? 0.24 : 0.18), in: Capsule())
      .overlay(Capsule().strokeBorder(selected ? .white.opacity(0.5) : color.opacity(0.45), lineWidth: 0.5))
  }
}

/// A small capsule beside a row's reference.
private struct RowChip<Content: View>: View {
  @ViewBuilder var content: Content

  var body: some View {
    content
      .lineLimit(1)
      .padding(.horizontal, 6)
      .padding(.vertical, 1)
      .background(.fill.tertiary, in: Capsule())
      .foregroundStyle(.secondary)
  }
}

/// The parent issue of a top-level issue that the list does not show above
/// it, which opens it.
private struct ParentChip: View {
  @Environment(AppModel.self) private var model
  var parent: ParentIssue
  var naming: RepositoryNaming

  var body: some View {
    let reference = parent.reference
    Button {
      model.openIssue(reference.id)
    } label: {
      RowChip {
        HStack(spacing: 2) {
          Image(systemName: parent.unread == nil ? "arrow.up" : unreadSymbol)
            .imageScale(.small)
          Text(naming.name(reference))
            .monospacedDigit()
        }
      }
    }
    .buttonStyle(.plain)
    .help("Parent issue: \(reference.title)")
    .accessibilityLabel("Parent issue \(reference.qualifiedReference)")
    .layoutPriority(1)
  }

  private var unreadSymbol: String {
    switch parent.unread {
    case .failed(.unavailable): "lock.fill"
    case .failed: "exclamationmark.triangle"
    default: "arrow.up"
    }
  }
}

/// The parent issue above a view's tree that the view cannot show: loading,
/// hidden from this account, or failed.
private struct MissingParentChip: View {
  var unread: UnreadIssue

  var body: some View {
    RowChip {
      switch unread {
      case .loading:
        HStack(spacing: 3) {
          ProgressView().controlSize(.mini)
          Text("parent")
        }
        .help("Loading the parent issue")
      case .failed(.unavailable(let message)):
        Label("hidden parent", systemImage: "lock.fill")
          .help(message)
      case .failed(let error):
        Label("parent", systemImage: "exclamationmark.triangle")
          .help("The parent issue could not be loaded: \(error.message)")
      }
    }
  }
}

/// How many matches a collapsed issue hides.
private struct InsideChip: View {
  var count: Int

  var body: some View {
    RowChip { Text("\(count) inside").monospacedDigit() }
      .help("\(count) \(count == 1 ? "match" : "matches") below this issue")
  }
}

/// An issue's first labels, each filtering the list by itself, as many as
/// fit, and `+N` for the rest, which lists them all.
private struct RowLabels: View {
  var labels: [VerdandiCore.Label]
  var onFilter: (VerdandiCore.Label) -> Void

  var body: some View {
    if !labels.isEmpty {
      ViewThatFits(in: .horizontal) {
        chips(min(3, labels.count))
        chips(min(2, labels.count))
        chips(1)
        chips(0)
      }
    }
  }

  private func chips(_ count: Int) -> some View {
    HStack(spacing: 4) {
      ForEach(labels.prefix(count)) { label in
        Button {
          onFilter(label)
        } label: {
          RowLabelChip(label: label)
        }
        .buttonStyle(.plain)
        .help("Show only issues labelled “\(label.name)”")
      }
      if labels.count > count {
        Menu {
          ForEach(labels) { label in
            Button(label.name) { onFilter(label) }
          }
        } label: {
          Text("+\(labels.count - count)")
            .font(.caption2.weight(.medium))
            .monospacedDigit()
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(.fill.tertiary, in: Capsule())
            .foregroundStyle(.secondary)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .help(labels.dropFirst(count).map(\.name).joined(separator: ", "))
      }
    }
    .fixedSize()
  }
}

/// Sub-issue progress, and how many issues block it and it blocks.
private struct RelationshipBadges: View {
  var issue: Issue

  var body: some View {
    HStack(spacing: 8) {
      if issue.subIssuesTotal > 0 {
        SubIssueProgress(completed: issue.subIssuesCompleted, total: issue.subIssuesTotal)
      }
      // A closed issue waits on nothing and holds up nothing.
      if issue.totalBlockedBy > 0 && issue.state == .open {
        RelationshipBadge(
          symbol: "hand.raised", open: issue.blockedBy, total: issue.totalBlockedBy,
          live: issue.state == .open && issue.blockedBy > 0, tint: .red,
          help: "Blocked by \(issue.blockedBy) open of \(issue.totalBlockedBy)")
      }
      if issue.totalBlocking > 0 && issue.state == .open {
        RelationshipBadge(
          symbol: "arrowshape.right", open: issue.blocking, total: issue.totalBlocking,
          live: issue.state == .open && issue.blocking > 0, tint: .orange,
          help: "Blocks \(issue.blocking) open of \(issue.totalBlocking)")
      }
    }
    .fixedSize()
    .layoutPriority(1)
  }
}

/// A ring filled as far as an issue's sub-issues are completed.
struct SubIssueProgress: View {
  @Environment(\.backgroundProminence) private var prominence
  var completed: Int
  var total: Int

  var body: some View {
    let fraction = total > 0 ? Double(completed) / Double(total) : 0
    let tint = prominence == .increased ? Color.white : Color.issueState(.closed)
    HStack(spacing: 3) {
      ZStack {
        Circle().stroke(.quaternary, lineWidth: 2)
        Circle()
          .trim(from: 0, to: fraction)
          .stroke(tint, style: StrokeStyle(lineWidth: 2, lineCap: .round))
          .rotationEffect(.degrees(-90))
      }
      .frame(width: 10, height: 10)
      Text("\(completed)/\(total)")
        .monospacedDigit()
        .contentTransition(.numericText())
    }
    .foregroundStyle(.secondary)
    .help("\(completed) of \(total) sub-issues completed")
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(completed) of \(total) sub-issues completed")
  }
}

/// How many issues block an issue, or it blocks: the open ones while any
/// is, tinted; otherwise a muted `open/total`.
private struct RelationshipBadge: View {
  @Environment(\.backgroundProminence) private var prominence
  var symbol: String
  var open: Int
  var total: Int
  var live: Bool
  var tint: Color
  var help: String

  var body: some View {
    HStack(spacing: 2) {
      Image(systemName: live ? "\(symbol).fill" : symbol)
        .imageScale(.small)
      Text(live ? "\(open)" : "\(open)/\(total)")
        .monospacedDigit()
        .contentTransition(.numericText())
    }
    .foregroundStyle(
      live ? AnyShapeStyle(prominence == .increased ? Color.white : tint) : AnyShapeStyle(.tertiary))
    .fontWeight(live ? .semibold : .regular)
    .help(help)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(help)
  }
}

/// What a row's context menu offers.
private struct RowMenu: View {
  @Environment(\.openURL) private var openURL
  var node: ForestNode
  var list: IssueListModel

  var body: some View {
    if let url = node.webURL {
      Button("Open on GitHub", systemImage: "safari") { openURL(url) }
      Button("Copy Link", systemImage: "link") { copy(url.absoluteString) }
    }
    Button("Copy Reference", systemImage: "number") { copy(node.reference.qualifiedReference) }
    if let labels = node.issue?.labels, !labels.isEmpty {
      Divider()
      Menu("Filter by Label", systemImage: "line.3.horizontal.decrease") {
        ForEach(labels) { label in
          Button(label.name) { list.addLabel(label) }
        }
      }
    }
    Divider()
    Button("Expand All", systemImage: "chevron.down") { list.setEverythingExpanded(true) }
    Button("Collapse All", systemImage: "chevron.right") { list.setEverythingExpanded(false) }
  }

  private func copy(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
  }
}

extension ForestNode {
  /// Where GitHub shows the issue, also one known only by reference.
  var webURL: URL? {
    issue?.url ?? reference.webURL
  }
}

