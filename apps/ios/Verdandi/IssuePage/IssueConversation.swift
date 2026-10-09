import SwiftUI
import VerdandiKit

/// The issue's description, as GitHub renders it.
struct IssueBodySection: View {
    @Environment(\.palette) private var palette
    let issue: IssueInfo?

    var body: some View {
        IssuePageSection("Description", systemImage: "text.alignleft") {
            Group {
                if let issue {
                    let html = issue.bodyHTML ?? ""
                    if html.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("No description provided.")
                            .italic()
                            .foregroundStyle(palette.muted)
                    } else {
                        BodyHTMLView(html: html, issueId: issue.id, bodyId: issue.id)
                    }
                } else {
                    PlaceholderLines(lines: 5)
                        .modifier(LoadingPulse())
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .issuePageCard()
        }
    }
}

/// The issue's comments, oldest first, and how far they have loaded:
/// while they are read, as they arrive; what could not be read, with a way
/// to read it again. Only comments show, not GitHub's timeline events.
struct IssueCommentsSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette
    let issue: IssueInfo
    let comments: IssueComments?

    var body: some View {
        let count = issue.commentCount ?? comments?.comments.count ?? 0
        IssuePageSection("Comments", systemImage: "bubble.left.and.bubble.right", count: "\(count)") {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(comments?.comments ?? []) { comment in
                    CommentView(
                        issueId: issue.id, comment: comment,
                        byAuthor: comment.author != nil && comment.author?.login == issue.author?.login)
                }
                status(count: count)
            }
        }
    }

    /// What the comments say of how far they have loaded, besides showing
    /// them; nothing while they are current or read again, as the
    /// navigation bar says so.
    @ViewBuilder private func status(count: Int) -> some View {
        let shown = comments?.comments.count ?? 0
        switch comments?.loading {
        case nil, .loading:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(shown > 0 ? "Loading… \(shown) of \(max(shown, count)) comments" : "Loading comments…")
            }
            .font(.subheadline)
            .foregroundStyle(palette.muted)
            .padding(.horizontal, 4)
        case .current where shown == 0:
            Text("No comments yet.")
                .font(.subheadline)
                .foregroundStyle(palette.muted)
                .padding(.horizontal, 4)
        case .failed(let problem):
            ProblemBanner(problem: problem) { Task { await model.retry() } }
        case .stale(let updatedAt, let problem):
            PartNotice(
                "Showing comments from \(IssuePageDates.time(of: Date(timeIntervalSince1970: updatedAt / 1000))). \(problem.message)"
            ) { actions }
        case .partial(_, let problem):
            PartNotice("Showing \(shown) of \(max(shown, count)) comments. \(problem.message)") { actions }
        case .current, .refreshing:
            EmptyView()
        }
    }

    @ViewBuilder private var actions: some View {
        Button("Retry") { Task { await model.retry() } }
        if let url = URL(string: issue.url) {
            Link("Open on GitHub", destination: url)
        }
    }
}

/// One comment: who wrote it and when, then what they wrote.
private struct CommentView: View {
    @Environment(\.palette) private var palette
    @Environment(\.openURL) private var openURL
    @ScaledMetric(relativeTo: .subheadline) private var avatarSize: CGFloat = 26
    let issueId: String
    let comment: IssueComment
    /// Whether the issue's author wrote it.
    let byAuthor: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Rectangle()
                .fill(palette.border)
                .frame(height: 0.5)
            BodyHTMLView(html: comment.bodyHTML, issueId: issueId, bodyId: comment.id)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
        }
        .issuePageCard()
    }

    private var header: some View {
        HStack(spacing: 8) {
            AvatarView(actor: comment.author, size: avatarSize)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 6) { names }
                VStack(alignment: .leading, spacing: 2) { names }
            }
            Spacer(minLength: 4)
            Menu {
                menu
            } label: {
                Image(systemName: "ellipsis")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(palette.muted)
                    .frame(width: 32, height: 32)
                    .contentShape(.rect)
            }
            .accessibilityLabel("Comment actions")
            .hoverEffect(.highlight)
        }
        .padding(.leading, 14)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .background(palette.foreground.opacity(0.03))
        .contentShape(.rect)
        .contextMenu { menu }
    }

    @ViewBuilder private var names: some View {
        Text(comment.author.map { "@\($0.login)" } ?? "Deleted user")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(palette.foreground)
            .lineLimit(1)
        HStack(spacing: 6) {
            if byAuthor {
                Text("Author")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(palette.muted)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .overlay(Capsule().strokeBorder(palette.border))
                    .accessibilityLabel("The issue's author")
            }
            if let created = comment.created {
                AgeText(date: created)
                    .font(.subheadline)
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
            }
        }
    }

    /// Open on GitHub, Copy Link and Share, under when it was written.
    @ViewBuilder private var menu: some View {
        if let url = URL(string: comment.url) {
            Section(comment.created.map { "Written \(IssuePageDates.full($0))" } ?? "") {
                Button("Open on GitHub", systemImage: "safari") { openURL(url) }
                Button("Copy Link", systemImage: "link") { GitHubLink.copy(url) }
                ShareLink(item: url) { Label("Share…", systemImage: "square.and.arrow.up") }
            }
        }
    }
}
