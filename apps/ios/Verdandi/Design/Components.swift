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

/// An issue as a row shows it: its state and title, and below them its
/// reference, its repository where the list does not say it, how it relates
/// to other issues, and its labels, wrapping as they need. Lists, sub-issue
/// outlines and pickers all use it.
struct IssueRowContent: View {
    @Environment(\.palette) private var palette
    var issue: IssueInfo
    /// Whether the row names its repository with a chip, as All does.
    var showsRepository = false
    /// Dimmed: a context issue, or an issue in the other state than the list's.
    var dimmed = false
    /// Why it has not been read, if it has not.
    var unread: UnreadIssue?
    /// Whether the dimming takes in the blocked-by and blocks counts too. It
    /// does for a context issue; a list that dims an issue only for being in
    /// the other state keeps them clear, since what blocks still counts.
    var dimsRelationships = true
    /// A context issue in a view whose results are incomplete, which may
    /// match too: its reference says so with "?".
    var mayMatch = false
    /// How many matches its collapsed sub-issues hold, said beside it.
    var matchesInside = 0
    /// Whether it says how long ago it was opened, at the end of its title.
    var showsAge = false
    /// Adds a label to the list's label filter: its labels are buttons then.
    var onFilterLabel: ((IssueLabel) -> Void)?

    /// How many labels show before `+N` stands for the rest.
    private static let labelsShown = 3
    private static let dimming = 0.5

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            StateIcon(state: issue.state, reason: issue.stateReason)
                .font(.body)
                .opacity(faded)
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(issue.title)
                        .font(.body)
                        .foregroundStyle(palette.foreground)
                        .lineLimit(3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if showsAge, let created = issue.created {
                        Text(IssueAge.short(since: created))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(palette.muted)
                            .accessibilityLabel("Opened \(created.formatted(.relative(presentation: .named)))")
                    }
                }
                .opacity(faded)
                details
            }
        }
    }

    /// What the row carries below its title, as one paragraph of chips.
    private var details: some View {
        FlowLayout(spacing: 6, lineSpacing: 5) {
            reference.opacity(faded)
            if showsRepository {
                RowRepositoryChip(repository: issue.repository, external: issue.external).opacity(faded)
            } else if issue.external {
                externalTag.opacity(faded)
            }
            if let progress = issue.subIssueProgress, progress.total > 0 {
                SubIssueProgressBadge(progress: progress).opacity(faded)
            }
            if let blockedBy = issue.blockedBy, blockedBy.total > 0 {
                RelationshipBadge(side: .blockedBy, count: blockedBy, state: issue.state).opacity(relationshipsFaded)
            }
            if let blocking = issue.blocking, blocking.total > 0 {
                RelationshipBadge(side: .blocking, count: blocking, state: issue.state).opacity(relationshipsFaded)
            }
            if matchesInside > 0 {
                Text("\(matchesInside) inside")
                    .font(.caption2.weight(.medium))
                    .monospacedDigit()
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .foregroundStyle(palette.muted)
                    .background(palette.muted.opacity(0.15), in: .capsule)
                    .opacity(faded)
                    .accessibilityLabel("\(matchesInside) \(matchesInside == 1 ? "match" : "matches") below this issue")
            }
            let labels = issue.labels ?? []
            ForEach(labels.prefix(Self.labelsShown)) { label in
                RowLabel(label: label, onFilter: onFilterLabel).opacity(faded)
            }
            if labels.count > Self.labelsShown {
                MoreLabels(labels: labels, hidden: labels.count - Self.labelsShown, onFilter: onFilterLabel)
                    .opacity(faded)
            }
            if let incomplete = issue.incomplete {
                Image(systemName: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(palette.warning)
                    .accessibilityLabel("Shown in part: \(ProblemText(incomplete).sentence)")
            }
            if let unread {
                UnreadNote(unread: unread)
            }
        }
    }

    private var reference: some View {
        HStack(spacing: 1) {
            Text(issue.reference)
            if mayMatch {
                Text("?").fontWeight(.bold)
            }
        }
        .font(.caption.monospacedDigit())
        .foregroundStyle(palette.muted)
        .lineLimit(1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(mayMatch ? "\(issue.reference), may match" : issue.reference)
    }

    /// Marks an issue outside every tracked repository, where no chip names
    /// its repository.
    private var externalTag: some View {
        Text("external")
            .font(.caption2)
            .foregroundStyle(palette.muted)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .overlay(Capsule().strokeBorder(palette.muted, style: StrokeStyle(lineWidth: 1, dash: [2, 2])))
            .accessibilityLabel("Not in a tracked repository")
    }

    private var faded: Double { dimmed ? Self.dimming : 1 }
    private var relationshipsFaded: Double { dimmed && dimsRelationships ? Self.dimming : 1 }
}

/// Lays its views out in rows, wrapping as a paragraph wraps words.
///
/// It places its views on the lines it measured for the width it was
/// offered, not for its bounds, which can be a hair narrower once rounded to
/// pixels: a List row sizes itself by what it measured, and a line that
/// placing added would be cut off. A view wider than a whole line is given
/// the line's width, to wrap or shorten in.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 4

    struct Line {
        var items: [(index: Int, size: CGSize)] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    /// Each view's own size, measured once for all the widths it is offered.
    func makeCache(subviews: Subviews) -> [CGSize] {
        subviews.map { $0.sizeThatFits(.unspecified) }
    }

    func updateCache(_ cache: inout [CGSize], subviews: Subviews) {
        cache = makeCache(subviews: subviews)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout [CGSize]) -> CGSize {
        let lines = arrange(subviews, sizes: cache, width: proposal.width ?? .infinity)
        let width = lines.map(\.width).max() ?? 0
        let height = lines.map(\.height).reduce(0, +) + lineSpacing * CGFloat(max(lines.count - 1, 0))
        return CGSize(width: proposal.width.map { min(width, $0) } ?? width, height: height)
    }

    func placeSubviews(
        in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout [CGSize]
    ) {
        let width = max(bounds.width, proposal.width ?? bounds.width)
        var y = bounds.minY
        for line in arrange(subviews, sizes: cache, width: width) {
            var x = bounds.minX
            for item in line.items {
                subviews[item.index].place(
                    at: CGPoint(x: x, y: y + (line.height - item.size.height) / 2), anchor: .topLeading,
                    proposal: ProposedViewSize(item.size))
                x += item.size.width + spacing
            }
            y += line.height + lineSpacing
        }
    }

    private func arrange(_ subviews: Subviews, sizes: [CGSize], width: CGFloat) -> [Line] {
        var lines: [Line] = []
        var line = Line()
        for (index, subview) in subviews.enumerated() {
            var size = sizes.indices.contains(index) ? sizes[index] : subview.sizeThatFits(.unspecified)
            if size.width == 0 && size.height == 0 { continue }
            if size.width > width {
                size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
                size.width = min(size.width, width)
            }
            // Half a point of slack, so that rounding never wraps a line that fits.
            if !line.items.isEmpty, line.width + spacing + size.width > width + 0.5 {
                lines.append(line)
                line = Line()
            }
            line.width += (line.items.isEmpty ? 0 : spacing) + size.width
            line.height = max(line.height, size.height)
            line.items.append((index, size))
        }
        if !line.items.isEmpty { lines.append(line) }
        return lines
    }
}
