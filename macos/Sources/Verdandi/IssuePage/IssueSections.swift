import AppKit
import SwiftUI
import VerdandiCore

/// The issue's sub-issues: how many are done, and each, opening its page.
struct SubIssuesSection: View {
  @Environment(AppModel.self) private var model
  var issue: Issue

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 12) {
        IssuePageSectionTitle("Sub-issues", systemImage: "list.bullet.indent")
        Spacer()
        Text(verbatim: "\(issue.subIssuesCompleted) of \(issue.subIssuesTotal) done")
          .font(.subheadline.monospacedDigit())
          .foregroundStyle(.secondary)
          .contentTransition(.numericText())
        ProgressView(value: Double(issue.subIssuesCompleted), total: Double(max(issue.subIssuesTotal, 1)))
          .progressViewStyle(.linear)
          .tint(Color.issueState(.closed))
          .frame(width: 120)
          .accessibilityLabel("\(issue.subIssuesCompleted) of \(issue.subIssuesTotal) sub-issues done")
      }
      VStack(spacing: 0) {
        ForEach(Array(issue.subIssues.enumerated()), id: \.element.id) { index, subIssue in
          if index > 0 { Divider().padding(.leading, 38) }
          SubIssueRow(subIssue: model.issues[subIssue.id]?.reference ?? subIssue, repository: issue.repository)
        }
        if issue.subIssuesTotal > issue.subIssues.count {
          if !issue.subIssues.isEmpty { Divider().padding(.leading, 38) }
          Button {
            NSWorkspace.shared.open(issue.url)
          } label: {
            Label(String("\(issue.subIssuesTotal - issue.subIssues.count) more on GitHub"), systemImage: "arrow.up.forward.square")
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.horizontal, 14)
              .padding(.vertical, 9)
          }
          .buttonStyle(.plain)
          .foregroundStyle(.secondary)
        }
      }
      .background(.fill.quinary, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(.separator.opacity(0.6)))
    }
  }
}

/// One sub-issue, which opens its page.
private struct SubIssueRow: View {
  @Environment(AppModel.self) private var model
  @Environment(IssueVisit.self) private var visit
  @Environment(\.pageCursor) private var cursor
  var subIssue: IssueReference
  var repository: RepositoryAddress
  @State private var hovering = false

  var body: some View {
    let issue = model.issues[subIssue.id]
    let hasCursor = cursor == .subIssue(subIssue.id)
    Button {
      model.pages.open(.subIssue(subIssue.id), in: visit)
    } label: {
      HStack(spacing: 10) {
        IssueStateIcon(state: subIssue.state)
        Text(subIssue.title)
          .lineLimit(1)
          .foregroundStyle(subIssue.state == .closed ? .secondary : .primary)
        if let issue, issue.state == .open, issue.blockedBy > 0 {
          Circle().fill(.orange).frame(width: 7, height: 7)
            .help("Blocked by \(issue.blockedBy) open \(issue.blockedBy == 1 ? "issue" : "issues")")
        }
        Spacer(minLength: 8)
        if let issue, issue.subIssuesTotal > 0 {
          Label(String("\(issue.subIssuesCompleted)/\(issue.subIssuesTotal)"), systemImage: "list.bullet.indent")
            .labelStyle(.titleAndIcon)
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
        Text(subIssue.repository == repository ? "#\(subIssue.number)" : subIssue.qualifiedReference)
          .font(.callout.monospacedDigit())
          .foregroundStyle(.secondary)
        Image(systemName: "chevron.forward")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.tertiary)
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 8)
      .background(hovering ? AnyShapeStyle(.fill.quaternary) : AnyShapeStyle(.clear))
      .overlay {
        if hasCursor {
          RoundedRectangle(cornerRadius: 9, style: .continuous)
            .fill(Color.accentColor.opacity(0.1))
            .strokeBorder(Color.accentColor, lineWidth: 2)
            .padding(3)
        }
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .id(PageCursor.subIssue(subIssue.id))
    .onHover { hovering = $0 }
    .contextMenu {
      if let issue {
        Button("Open on GitHub", systemImage: "safari") { NSWorkspace.shared.open(issue.url) }
      }
    }
  }
}

/// The issue's body, as GitHub rendered it.
struct IssueBodySection: View {
  @Environment(AppModel.self) private var model
  var page: IssuePageModel
  var issue: Issue

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      IssuePageSectionTitle("Description", systemImage: "text.alignleft")
      if let details = page.details {
        let bodyHTML = LaunchOptions.bodyHTML ?? details.bodyHTML
        if bodyHTML.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          Text("No description provided.")
            .italic()
            .foregroundStyle(.secondary)
        } else {
          GitHubHTMLView(
            html: bodyHTML, knownHeight: page.bodyHeights[issue.id],
            onLink: { model.pages.follow($0) }, onHeight: { page.bodyHeights[issue.id] = $0 })
        }
      } else if page.detailsPhase.error != nil {
        Text("The description could not be loaded.")
          .foregroundStyle(.secondary)
      } else {
        PlaceholderText(lines: 5)
      }
    }
  }
}

/// The issue's comments, oldest first, along a thin timeline.
struct IssueCommentsSection: View {
  @Environment(AppModel.self) private var model
  var page: IssuePageModel
  var issue: Issue

  var body: some View {
    let count = page.details?.commentCount ?? page.comments.count
    VStack(alignment: .leading, spacing: 14) {
      IssuePageSectionTitle("Comments", systemImage: "bubble.left.and.bubble.right", count: count)
      if !page.comments.isEmpty {
        LazyVStack(alignment: .leading, spacing: 16) {
          ForEach(page.comments) { comment in
            IssueCommentView(
              comment: comment, isByAuthor: comment.author != nil && comment.author?.login == issue.author?.login,
              page: page)
          }
        }
        .background(alignment: .topLeading) {
          Rectangle()
            .fill(.separator)
            .frame(width: 1)
            .padding(.leading, 14)
            .padding(.vertical, 20)
        }
      }
      switch page.commentsPhase {
      case .loading where page.comments.count < count || count == 0 && page.details == nil:
        HStack(spacing: 8) {
          ProgressView().controlSize(.small)
          Text("Loading comments…").foregroundStyle(.secondary)
        }
        .font(.callout)
      case .failed(let error):
        IssuePageNotice(text: "Comments could not be loaded: \(error.message)") {
          Task { await model.pages.refresh(page.issueID) }
        }
      case .loaded where page.comments.isEmpty:
        Text("No comments yet.")
          .foregroundStyle(.secondary)
      default:
        EmptyView()
      }
    }
  }
}

/// One comment: who wrote it and when, then what they wrote.
private struct IssueCommentView: View {
  @Environment(AppModel.self) private var model
  var comment: IssueComment
  var isByAuthor: Bool
  var page: IssuePageModel

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      AvatarView(actor: comment.author, size: 29)
        .overlay(Circle().strokeBorder(Color(nsColor: .windowBackgroundColor), lineWidth: 2).padding(-1))
      VStack(alignment: .leading, spacing: 10) {
        HStack(spacing: 6) {
          Text(comment.author.map { "@\($0.login)" } ?? "Deleted user")
            .fontWeight(.semibold)
          if isByAuthor {
            Text("Author")
              .font(.caption2.weight(.medium))
              .padding(.horizontal, 6)
              .padding(.vertical, 1)
              .overlay(Capsule().strokeBorder(.separator))
              .foregroundStyle(.secondary)
          }
          Text(comment.createdAt.relativeInEnglish)
            .foregroundStyle(.secondary)
            .help(comment.createdAt.formatted(date: .long, time: .shortened))
          Spacer(minLength: 8)
          Menu {
            Button("Open on GitHub", systemImage: "safari") { NSWorkspace.shared.open(comment.url) }
            Button("Copy Link", systemImage: "link") {
              NSPasteboard.general.clearContents()
              NSPasteboard.general.setString(comment.url.absoluteString, forType: .string)
            }
          } label: {
            Image(systemName: "ellipsis")
          }
          .menuStyle(.button)
          .buttonStyle(.borderless)
          .menuIndicator(.hidden)
          .fixedSize()
          .accessibilityLabel("Comment actions")
        }
        .font(.callout)
        GitHubHTMLView(
          html: comment.bodyHTML, knownHeight: page.bodyHeights[comment.id],
          onLink: { model.pages.follow($0) }, onHeight: { page.bodyHeights[comment.id] = $0 })
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .background(.fill.quinary, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(.separator.opacity(0.6)))
    }
  }
}

/// Grey lines where text will be, while it loads.
private struct PlaceholderText: View {
  var lines: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(0..<lines, id: \.self) { line in
        Text(String(repeating: "Lorem ipsum dolor ", count: line == lines - 1 ? 3 : 7))
          .lineLimit(1)
      }
    }
    .redacted(reason: .placeholder)
    .foregroundStyle(.secondary)
    .accessibilityLabel("Loading")
  }
}
