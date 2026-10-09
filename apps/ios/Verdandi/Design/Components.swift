import SwiftUI
import VerdandiKit

// Small views every feature uses, so that an issue looks the same wherever
// it shows: in a list, on a page, in the blocking map.

/// An issue's state, as GitHub draws it: open, closed as completed, or
/// closed as not planned.
struct StateIcon: View {
    @Environment(\.palette) private var palette
    var state: IssueState
    var reason: StateReason?

    var body: some View {
        Image(systemName: symbol)
            .symbolRenderingMode(.hierarchical)
            .foregroundStyle(color)
            .accessibilityLabel(label)
    }

    private var symbol: String {
        switch (state, reason) {
        case (.open, _): "smallcircle.filled.circle"
        case (.closed, .notPlanned), (.closed, .duplicate): "slash.circle"
        case (.closed, _): "checkmark.circle"
        }
    }

    private var color: Color {
        switch (state, reason) {
        case (.open, _): palette.open
        case (.closed, .notPlanned), (.closed, .duplicate): palette.muted
        case (.closed, _): palette.closed
        }
    }

    private var label: String {
        switch (state, reason) {
        case (.open, _): "Open"
        case (.closed, .notPlanned): "Closed as not planned"
        case (.closed, .duplicate): "Closed as a duplicate"
        case (.closed, _): "Closed"
        }
    }
}

/// A label as GitHub colours it.
struct LabelChip: View {
    var label: IssueLabel
    var compact = false

    var body: some View {
        Text(label.name)
            .font(compact ? .caption2.weight(.medium) : .caption.weight(.medium))
            .lineLimit(1)
            .padding(.horizontal, compact ? 6 : 8)
            .padding(.vertical, compact ? 1 : 3)
            .foregroundStyle(label.prefersDarkText ? Color.black.opacity(0.85) : .white)
            .background(label.swatch, in: .capsule)
            .accessibilityLabel("Label \(label.name)")
    }
}

/// The repository an issue lives in, where the list does not say it.
struct RepositoryChip: View {
    @Environment(\.palette) private var palette
    var repository: RepositoryAddress

    var body: some View {
        Label(repository.name, systemImage: "book.closed")
            .labelStyle(.titleAndIcon)
            .font(.caption.weight(.medium))
            .foregroundStyle(palette.muted)
            .lineLimit(1)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(palette.muted.opacity(0.12), in: .capsule)
            .accessibilityLabel("Repository \(repository.nameWithOwner)")
    }
}

/// A GitHub account's picture, round.
struct AvatarView: View {
    var actor: IssueActor?
    var size: CGFloat = 20

    var body: some View {
        AsyncImage(url: actor.flatMap { URL(string: $0.avatarUrl) }) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Image(systemName: "person.crop.circle.fill")
                .resizable()
                .foregroundStyle(.tertiary)
        }
        .frame(width: size, height: size)
        .clipShape(.circle)
        .accessibilityHidden(true)
    }
}

/// How many issues block one, and how many it blocks, of all, in the
/// map's colours: red for blocked by, amber for blocks. Nothing shows for a
/// side without any.
struct RelationshipCounts: View {
    @Environment(\.palette) private var palette
    var blockedBy: RelationshipCount?
    var blocking: RelationshipCount?
    var subIssues: SubIssueProgress?

    var body: some View {
        HStack(spacing: 10) {
            if let subIssues, subIssues.total > 0 {
                Label("\(subIssues.closed)/\(subIssues.total)", systemImage: "list.bullet.indent")
                    .foregroundStyle(palette.muted)
                    .accessibilityLabel("\(subIssues.closed) of \(subIssues.total) sub-issues closed")
            }
            if let blockedBy, blockedBy.total > 0 {
                Label("\(blockedBy.open)", systemImage: "arrow.down.left.circle")
                    .foregroundStyle(blockedBy.open > 0 ? palette.blocked : palette.muted)
                    .accessibilityLabel("Blocked by \(blockedBy.open) open of \(blockedBy.total)")
            }
            if let blocking, blocking.total > 0 {
                Label("\(blocking.open)", systemImage: "arrow.up.right.circle")
                    .foregroundStyle(blocking.open > 0 ? palette.blocking : palette.muted)
                    .accessibilityLabel("Blocks \(blocking.open) open of \(blocking.total)")
            }
        }
        .labelStyle(CompactLabelStyle())
        .font(.caption.monospacedDigit())
    }
}

/// An icon and its text, close together.
struct CompactLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 3) {
            configuration.icon
            configuration.title
        }
    }
}

/// What could not be read, and a way to try again.
struct ProblemBanner: View {
    @Environment(\.palette) private var palette
    var problem: Problem
    /// Shown from before, so the rest of the screen still holds.
    var stale = false
    var retry: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: icon)
                .foregroundStyle(palette.warning)
            VStack(alignment: .leading, spacing: 2) {
                if stale {
                    Text("Shown as it was before.").font(.subheadline.weight(.semibold))
                }
                Text(problem.message)
                    .font(.subheadline)
                    .foregroundStyle(stale ? palette.muted : palette.foreground)
                if case .unavailable(.sso(_, let url?), _, _) = problem, let link = URL(string: url) {
                    Link("Authorize for single sign-on", destination: link).font(.subheadline.weight(.semibold))
                }
            }
            Spacer(minLength: 0)
            if let retry {
                Button("Retry", action: retry)
                    .buttonStyle(.glass)
                    .controlSize(.small)
            }
        }
        .padding(12)
        .background(palette.warning.opacity(0.12), in: .rect(cornerRadius: 14))
    }

    private var icon: String {
        switch problem {
        case .unreachable: "wifi.exclamationmark"
        case .unavailable: "eye.slash"
        default: "exclamationmark.triangle"
        }
    }
}

/// When something was read, as "Updated 3 min ago".
struct UpdatedText: View {
    var date: Date

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            Text(context.date.timeIntervalSince(date) < 45 ? "Updated just now" : "Updated \(date, format: .relative(presentation: .named))")
        }
    }
}

/// An issue as a row shows it: its state, title and reference, and what
/// it carries. Lists, sub-issue outlines and pickers all use it.
struct IssueRowContent: View {
    @Environment(\.palette) private var palette
    var issue: IssueInfo
    /// Whether the row names its repository with a chip, as All does.
    var showsRepository = false
    /// Dimmed: a context issue, or an issue in the other state than the list's.
    var dimmed = false
    /// Why it has not been read, if it has not.
    var unread: UnreadIssue?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            StateIcon(state: issue.state, reason: issue.stateReason)
                .font(.body)
            VStack(alignment: .leading, spacing: 4) {
                Text(issue.title)
                    .font(.body)
                    .foregroundStyle(palette.foreground)
                    .lineLimit(3)
                FlowLayout(spacing: 6) {
                    Text(issue.reference)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(palette.muted)
                    if showsRepository { RepositoryChip(repository: issue.repository) }
                    if issue.external {
                        Image(systemName: "arrow.up.forward.square")
                            .font(.caption)
                            .foregroundStyle(palette.muted)
                            .accessibilityLabel("Outside your tracked repositories")
                    }
                    ForEach(issue.labels ?? []) { label in LabelChip(label: label, compact: true) }
                    RelationshipCounts(
                        blockedBy: issue.blockedBy, blocking: issue.blocking, subIssues: issue.subIssueProgress)
                    switch unread {
                    case .loading:
                        ProgressView().controlSize(.mini)
                    case .failed(let problem):
                        Label(problem.message, systemImage: "exclamationmark.triangle")
                            .font(.caption)
                            .foregroundStyle(palette.warning)
                            .lineLimit(1)
                    case nil:
                        EmptyView()
                    }
                }
            }
        }
        .opacity(dimmed ? 0.55 : 1)
    }
}

/// Lays its views out in rows, wrapping as a paragraph wraps words.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, lineHeight: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if size.width == 0 { continue }
            if x > 0, x + size.width > width {
                y += lineHeight + lineSpacing
                x = 0
                lineHeight = 0
            }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            lineHeight = max(lineHeight, size.height)
        }
        return CGSize(width: min(widest, width), height: y + lineHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, lineHeight: CGFloat = 0
        var line: [(LayoutSubview, CGSize, CGFloat)] = []
        func placeLine() {
            for (subview, size, at) in line {
                subview.place(
                    at: CGPoint(x: at, y: y + (lineHeight - size.height) / 2), anchor: .topLeading,
                    proposal: ProposedViewSize(size))
            }
            line = []
        }
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if size.width == 0 { continue }
            if x > bounds.minX, x + size.width > bounds.maxX {
                placeLine()
                y += lineHeight + lineSpacing
                x = bounds.minX
                lineHeight = 0
            }
            line.append((subview, size, x))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
        placeLine()
    }
}
