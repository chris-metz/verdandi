import AppKit
import SwiftUI
import VerdandiCore

extension Date {
  /// "3 days ago", in English as the rest of the app, whatever the
  /// system's language.
  var relativeInEnglish: String {
    formatted(
      Date.RelativeFormatStyle(
        presentation: .named, locale: Locale(languageCode: .english, languageRegion: Locale.current.region)))
  }
}

/// How the page is laid out.
enum IssuePageMetrics {
  /// The widest text reads well at.
  static let textWidth: CGFloat = 860
  static let margin: CGFloat = 32
}

/// The parts of a page that can be scrolled to.
enum IssuePageSection: String, Hashable {
  case map, subIssues, body, comments, end
}

extension View {
  /// Centres the view at a width text reads well at, within the page's
  /// margins.
  func issuePageColumn() -> some View {
    frame(maxWidth: IssuePageMetrics.textWidth, alignment: .leading)
      .padding(.horizontal, IssuePageMetrics.margin)
      .frame(maxWidth: .infinity)
  }
}

/// An issue's page: where it stands among its parent issues, its title and
/// metadata, its blocking map, sub-issues, body and comments. It shows at
/// once from the issue the list read, and fills in as the rest arrives.
struct IssuePageView: View {
  @Environment(AppModel.self) private var model
  var issueID: String

  var body: some View {
    let page = model.pages.page(for: issueID)
    let issue = model.issues[issueID] ?? page.details?.issue
    Group {
      if case .failed(let error) = page.detailsPhase, issue == nil || isUnavailable(error) {
        IssuePageProblem(error: error, url: issue?.url) {
          Task { await model.pages.refresh(issueID) }
        }
      } else if let issue {
        IssuePageContent(page: page, issue: issue)
      } else {
        ProgressView()
          .controlSize(.large)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    // Break lines as English does, as the rest of the app is in English,
    // rather than by the system's language.
    .typesettingLanguage(Locale.Language(identifier: "en"))
    .task(id: issueID) { await model.pages.open(issueID) }
  }

  private func isUnavailable(_ error: GitHubError) -> Bool {
    if case .unavailable = error { return true }
    return false
  }
}

/// Why a page could not show its issue, with what to do about it.
private struct IssuePageProblem: View {
  var error: GitHubError
  var url: URL?
  var retry: () -> Void

  var body: some View {
    ContentUnavailableView {
      if case .unavailable = error {
        Label("Issue Unavailable", systemImage: "eye.slash")
      } else {
        Label("Could Not Load Issue", systemImage: "exclamationmark.triangle")
      }
    } description: {
      Text(error.message)
    } actions: {
      HStack {
        Button("Try Again", action: retry)
          .buttonStyle(.glassProminent)
        if let url {
          Button("Open on GitHub") { NSWorkspace.shared.open(url) }
            .buttonStyle(.glass)
        }
      }
    }
  }
}

/// The page's scrolling content.
private struct IssuePageContent: View {
  @Environment(AppModel.self) private var model
  var page: IssuePageModel
  var issue: Issue

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          IssueHeaderView(page: page, issue: issue) { section in
            withAnimation(.smooth) { proxy.scrollTo(section, anchor: .top) }
          }
          .issuePageColumn()
          .padding(.top, 18)
          .padding(.bottom, 26)

          if issue.totalBlockedBy + issue.totalBlocking > 0 {
            BlockingMapBand(page: page, issue: issue)
              .id(IssuePageSection.map)
          }

          VStack(alignment: .leading, spacing: 36) {
            if let error = page.detailsPhase.error {
              IssuePageNotice(text: "Could not read the issue again: \(error.message)") {
                Task { await model.pages.refresh(page.issueID) }
              }
            }
            if issue.subIssuesTotal > 0 {
              SubIssuesSection(issue: issue)
                .id(IssuePageSection.subIssues)
            }
            IssueBodySection(page: page, issue: issue)
              .id(IssuePageSection.body)
            IssueCommentsSection(page: page, issue: issue)
              .id(IssuePageSection.comments)
          }
          .issuePageColumn()
          .padding(.top, 30)
          .padding(.bottom, 48)
          Color.clear.frame(height: 1).id(IssuePageSection.end)
        }
      }
      .task(id: page.commentsPhase) {
        // A launch option, to look at a part of a page without scrolling.
        guard let name = LaunchOptions.environment["VERDANDI_SCROLL"],
          let section = IssuePageSection(rawValue: name), case .loaded = page.commentsPhase
        else { return }
        try? await Task.sleep(for: .seconds(2))
        proxy.scrollTo(section, anchor: .top)
      }
    }
  }
}

/// The page's top: the parent issues above it, its reference, title and
/// metadata.
private struct IssueHeaderView: View {
  @Environment(AppModel.self) private var model
  var page: IssuePageModel
  var issue: Issue
  var scrollTo: (IssuePageSection) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      let ancestry = model.pages.ancestry(of: issue.id)
      if !ancestry.isEmpty || (issue.hasParent && page.ancestryPhase.isLoading) {
        AncestryView(ancestry: ancestry, loading: page.ancestryPhase.isLoading)
      }
      HStack(spacing: 6) {
        Image(systemName: "book.closed")
        Text(issue.repository.description)
        Text(verbatim: "#\(issue.number)").monospacedDigit()
        if !isTracked {
          Text("External")
            .font(.caption.weight(.medium))
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .overlay(Capsule().strokeBorder(.separator))
            .help("Its repository is not one of the tracked repositories")
        }
      }
      .font(.callout)
      .foregroundStyle(.secondary)
      .textSelection(.enabled)

      Text(issue.title)
        .font(.largeTitle.weight(.bold))
        .textSelection(.enabled)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.bottom, 4)

      IssueMetadataView(page: page, issue: issue, scrollTo: scrollTo)
    }
  }

  private var isTracked: Bool {
    model.settings.repositories.contains { $0.address == issue.repository }
  }
}

/// The parent issue, its parent and so on up to the top, each opening its
/// page.
private struct AncestryView: View {
  @Environment(AppModel.self) private var model
  var ancestry: [IssueReference]
  var loading: Bool

  var body: some View {
    MetadataFlowLayout(spacing: 2, lineSpacing: 4) {
      ForEach(ancestry) { parent in
        Button { model.pages.show(parent.id) } label: {
          HStack(spacing: 5) {
            IssueStateIcon(state: parent.state).imageScale(.small)
            Text(parent.qualifiedReference).monospacedDigit()
            Text("·").foregroundStyle(.tertiary)
            Text(parent.title).lineLimit(1)
          }
          .frame(maxWidth: 360, alignment: .leading)
        }
        .buttonStyle(CrumbButtonStyle())
        .help("Parent issue: \(parent.title)")
        Image(systemName: "chevron.forward")
          .font(.caption2.weight(.semibold))
          .foregroundStyle(.tertiary)
      }
      if loading && ancestry.isEmpty {
        ProgressView().controlSize(.mini)
      }
    }
    .font(.callout)
    .foregroundStyle(.secondary)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Parent issues")
  }
}

/// A breadcrumb: text that shows it can be clicked when the pointer is on it.
private struct CrumbButtonStyle: ButtonStyle {
  @State private var hovering = false

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .padding(.horizontal, 6)
      .padding(.vertical, 3)
      .background(
        RoundedRectangle(cornerRadius: 6, style: .continuous)
          .fill(.fill.tertiary)
          .opacity(configuration.isPressed ? 1 : hovering ? 0.7 : 0))
      .foregroundStyle(hovering ? .primary : .secondary)
      .contentShape(Rectangle())
      .onHover { hovering = $0 }
  }
}

/// State, blocking relationships, labels, author, assignees, milestone and
/// comments, wrapping as the page narrows.
private struct IssueMetadataView: View {
  @Environment(AppModel.self) private var model
  var page: IssuePageModel
  var issue: Issue
  var scrollTo: (IssuePageSection) -> Void

  var body: some View {
    let details = page.details
    MetadataFlowLayout(spacing: 8, lineSpacing: 8) {
      IssueStateBadge(state: issue.state, reason: details?.stateReason)
      if issue.totalBlockedBy + issue.totalBlocking > 0 {
        GlassEffectContainer(spacing: 6) {
          HStack(spacing: 6) {
            ForEach(BlockingSide.allCases, id: \.self) { side in
              if issue.blockingTotal(side) > 0 {
                RelationshipCapsule(side: side, open: issue.blockingOpen(side), total: issue.blockingTotal(side)) {
                  scrollTo(.map)
                }
              }
            }
          }
        }
      }
      ForEach(issue.labels) { LabelChip(label: $0) }
      Group {
        HStack(spacing: 6) {
          AvatarView(actor: issue.author, size: 18)
          let author = Text(issue.author.map { "@\($0.login)" } ?? "Deleted user").fontWeight(.medium).foregroundStyle(.primary)
          Text("\(author) opened \(issue.createdAt.relativeInEnglish)")
            .help(issue.createdAt.formatted(date: .long, time: .shortened))
        }
        if let assignees = details?.assignees, !assignees.isEmpty {
          HStack(spacing: -5) {
            ForEach(assignees, id: \.login) { assignee in
              AvatarView(actor: assignee, size: 20)
                .overlay(Circle().strokeBorder(Color(nsColor: .windowBackgroundColor), lineWidth: 1.5))
            }
          }
          .help("Assigned to " + assignees.map { "@\($0.login)" }.formatted(.list(type: .and)))
          .accessibilityLabel("Assigned to " + assignees.map(\.login).formatted(.list(type: .and)))
        }
        if let milestone = details?.milestone {
          Label(milestone, systemImage: "signpost.right")
            .help("Milestone")
        }
        if let count = details?.commentCount, count > 0 {
          Button { scrollTo(.comments) } label: {
            Label(String("\(count) \(count == 1 ? "comment" : "comments")"), systemImage: "bubble.left.and.bubble.right")
              .contentTransition(.numericText())
          }
          .buttonStyle(.plain)
        }
      }
      .font(.callout)
      .foregroundStyle(.secondary)
      .padding(.leading, 4)
    }
    .animation(.smooth, value: details?.commentCount)
  }
}

/// Whether an issue is open or closed, and why, in GitHub's colours.
struct IssueStateBadge: View {
  var state: IssueState
  var reason: StateReason?

  var body: some View {
    let color = Color.issueState(state, reason: reason)
    HStack(spacing: 5) {
      IssueStateIcon(state: state, reason: reason)
      Text(title)
    }
    .font(.callout.weight(.semibold))
    .foregroundStyle(color)
    .padding(.horizontal, 10)
    .padding(.vertical, 4)
    .background(color.opacity(0.14), in: Capsule())
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(title)
  }

  private var title: String {
    switch (state, reason) {
    case (.open, _): "Open"
    case (.closed, .notPlanned): "Not planned"
    case (.closed, .duplicate): "Duplicate"
    case (.closed, _): "Closed"
    }
  }
}

/// How many of an issue's blockers, or of the issues it blocks, are open,
/// of all of them; a click scrolls to the map.
private struct RelationshipCapsule: View {
  var side: BlockingSide
  var open: Int
  var total: Int
  var action: () -> Void

  var body: some View {
    let live = side == .blockedBy && open > 0
    Button(action: action) {
      HStack(spacing: 5) {
        Image(systemName: side == .blockedBy ? "arrow.backward.circle" : "arrow.forward.circle")
          .symbolVariant(open > 0 ? .fill : .none)
        Text(side == .blockedBy ? "Blocked by" : "Blocks")
        Text(verbatim: "\(open)/\(total)")
          .monospacedDigit()
          .contentTransition(.numericText())
      }
      .font(.callout.weight(.medium))
      .foregroundStyle(live ? AnyShapeStyle(.orange) : AnyShapeStyle(.primary))
      .padding(.horizontal, 10)
      .padding(.vertical, 4)
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .glassEffect(live ? .regular.tint(.orange.opacity(0.18)).interactive() : .regular.interactive(), in: .capsule)
    .help("\(open) open of \(total) — show the blocking map")
  }
}

/// A notice on the page about a part that could not be read.
struct IssuePageNotice: View {
  var text: String
  var retry: (() -> Void)?

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
      Text(text).foregroundStyle(.secondary)
      Spacer(minLength: 8)
      if let retry {
        Button("Retry", action: retry).controlSize(.small)
      }
    }
    .font(.callout)
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .background(.fill.quinary, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
  }
}

/// A section's title, as the page's sections share it.
struct IssuePageSectionTitle: View {
  var title: String
  var systemImage: String
  var count: Int?

  init(_ title: String, systemImage: String, count: Int? = nil) {
    self.title = title
    self.systemImage = systemImage
    self.count = count
  }

  var body: some View {
    HStack(spacing: 6) {
      Label(title, systemImage: systemImage)
        .font(.headline)
      if let count {
        Text(count, format: .number)
          .font(.subheadline.monospacedDigit())
          .foregroundStyle(.secondary)
          .contentTransition(.numericText())
      }
    }
    .accessibilityAddTraits(.isHeader)
  }
}

/// Lays out views in rows, left to right, wrapping when a row is full.
struct MetadataFlowLayout: Layout {
  var spacing: CGFloat = 8
  var lineSpacing: CGFloat = 8

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = rows(width: proposal.width ?? .infinity, subviews: subviews)
    let width = rows.map(\.width).max() ?? 0
    let height = rows.map(\.height).reduce(0, +) + lineSpacing * CGFloat(max(0, rows.count - 1))
    return CGSize(width: proposal.width.map { min($0, width) } ?? width, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for row in rows(width: bounds.width, subviews: subviews) {
      var x = bounds.minX
      for index in row.indices {
        let size = size(of: subviews[index], width: bounds.width)
        subviews[index].place(
          at: CGPoint(x: x, y: y + row.height / 2), anchor: .leading,
          proposal: ProposedViewSize(size))
        x += size.width + spacing
      }
      y += row.height + lineSpacing
    }
  }

  private struct Row {
    var indices: [Int] = []
    var width: CGFloat = 0
    var height: CGFloat = 0
  }

  private func rows(width: CGFloat, subviews: Subviews) -> [Row] {
    var rows: [Row] = []
    var row = Row()
    for index in subviews.indices {
      let size = size(of: subviews[index], width: width)
      let itemWidth = size.width
      if !row.indices.isEmpty, row.width + spacing + itemWidth > width {
        rows.append(row)
        row = Row()
      }
      row.width += (row.indices.isEmpty ? 0 : spacing) + itemWidth
      row.height = max(row.height, size.height)
      row.indices.append(index)
    }
    if !row.indices.isEmpty { rows.append(row) }
    return rows
  }

  /// A view's ideal size, narrowed to the width if it is wider.
  private func size(of subview: LayoutSubview, width: CGFloat) -> CGSize {
    let ideal = subview.sizeThatFits(.unspecified)
    guard ideal.width > width else { return ideal }
    return subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
  }
}
