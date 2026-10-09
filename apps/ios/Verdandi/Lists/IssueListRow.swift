import SwiftUI
import VerdandiKit

/// How a list shows each of its rows.
struct RowStyle: Equatable {
    /// The state of the list's issues: issues in the other state are
    /// dimmed. None in a view, whose issues are in any state.
    var listState: IssueState?
    /// Whether rows name their repository with a chip, as All and views do.
    var showsRepository: Bool

    /// The width of the column the disclosure chevron stands in.
    nonisolated static let gutter: CGFloat = 28
    /// How far each level of sub-issues is indented.
    nonisolated static let indent: CGFloat = 20
}

/// One row of a list: an issue under its parent, indented with guides down
/// to it, a chevron where it has sub-issues, and the parent issue the list
/// does not show named above a tree. Or, in a view, the placeholder for a
/// parent issue that could not be shown, with its tree nested below it.
///
/// Dimmed exactly as the contract says: where issues are marked, as in a
/// view or a list its label filter narrows, only context issues are, as
/// whole rows; elsewhere, issues in the other state than the list's are,
/// their blocking counts kept clear, since what blocks still counts. An
/// issue that has not been read is dimmed too, with why.
struct IssueListRow: View, Equatable {
    @Environment(\.palette) private var palette
    let row: ListRow
    let style: RowStyle
    let controller: ListController

    /// Equal as long as it shows the same: the controller is the list's
    /// own, and the palette comes from the environment.
    static func == (a: Self, b: Self) -> Bool {
        a.row == b.row && a.style == b.style && a.controller === b.controller
    }

    var body: some View {
        switch row.kind {
        case .issue: issue
        case .missingParent(let problem): missingParent(problem)
        }
    }

    private var issue: some View {
        let context = row.mark.map { !$0.match } ?? false
        let otherState = row.mark == nil && style.listState.map { row.issue.state != $0 } ?? false
        let separatorLeading = CGFloat(row.depth) * RowStyle.indent + RowStyle.gutter
        return VStack(alignment: .leading, spacing: 6) {
            if let parent = row.parent {
                ParentLine(parent: parent) { controller.open(parent.route) }
                    .padding(.leading, RowStyle.gutter)
            } else if row.parentLoading {
                Label {
                    Text("Loading the parent issue…")
                } icon: {
                    ProgressView().controlSize(.mini)
                }
                .labelStyle(CompactLabelStyle())
                .font(.caption)
                .foregroundStyle(palette.muted)
                .padding(.leading, RowStyle.gutter)
            }
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(palette.muted)
                    .rotationEffect(.degrees(row.expanded ? 90 : 0))
                    .frame(width: RowStyle.gutter)
                    .opacity(row.hasSubIssues ? 1 : 0)
                    .accessibilityHidden(true)
                IssueRowContent(
                    issue: row.issue, showsRepository: style.showsRepository,
                    dimmed: context || otherState || row.unread != nil, unread: row.unread,
                    dimsRelationships: context, mayMatch: row.mark?.mayMatch == true,
                    matchesInside: row.hasSubIssues && !row.expanded ? row.mark?.matchesInside ?? 0 : 0,
                    showsAge: true,
                    onFilterLabel: { label in controller.filter(by: label) })
            }
        }
        .padding(.vertical, 10)
        .overlay(alignment: .leading) {
            if row.hasSubIssues {
                // The whole height of the row beside the issue, an easy
                // target for a thumb, without opening the issue.
                Button {
                    controller.setExpanded(row, !row.expanded)
                } label: {
                    Color.clear
                        .frame(width: RowStyle.gutter)
                        .frame(maxHeight: .infinity)
                        .contentShape(.rect)
                }
                .buttonStyle(.borderless)
                .accessibilityHidden(true)
            }
        }
        .padding(.leading, CGFloat(row.depth) * RowStyle.indent)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(alignment: .leading) { IndentGuides(depth: row.depth) }
        .alignmentGuide(.listRowSeparatorLeading) { _ in separatorLeading }
        .accessibilityElement(children: .combine)
        .accessibilityValue(accessibilityValue)
        .accessibilityActions { accessibilityActions }
    }

    private func missingParent(_ problem: Problem) -> some View {
        let unavailable = if case .unavailable = problem { true } else { false }
        return HStack(spacing: 8) {
            Image(systemName: unavailable ? "lock.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(unavailable ? palette.muted : palette.warning)
            Text(unavailable ? "Parent issue not visible to you" : "Parent issue could not be loaded")
                .foregroundStyle(palette.muted)
            if !unavailable {
                Button("Retry") { controller.retry() }
                    .buttonStyle(.borderless)
            }
        }
        .font(.subheadline)
        .padding(.vertical, 10)
        .padding(.leading, RowStyle.gutter)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityHint(ProblemText(problem).sentence)
    }

    private var accessibilityValue: String {
        var parts: [String] = []
        if row.depth > 0 { parts.append("Level \(row.depth + 1)") }
        if row.hasSubIssues { parts.append(row.expanded ? "Expanded" : "Collapsed") }
        if let mark = row.mark, !mark.match {
            parts.append(mark.mayMatch ? "Context issue, may match too" : "Context issue")
        }
        return parts.joined(separator: ", ")
    }

    @ViewBuilder private var accessibilityActions: some View {
        if row.hasSubIssues {
            Button(row.expanded ? "Collapse" : "Expand") { controller.setExpanded(row, !row.expanded) }
        }
        if let parent = row.parent {
            Button("Open Parent Issue \(parent.reference)") { controller.open(parent.route) }
        }
        ForEach(row.labels) { label in
            Button("Filter by \(label.name)") { controller.filter(by: label) }
        }
    }
}

/// The parent issue above a tree that the list does not show there: it
/// lives in another repository, or has not loaded. It opens the issue.
private struct ParentLine: View {
    @Environment(\.palette) private var palette
    var parent: ParentIssue
    var open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                icon
                Text("in \(Text(parent.reference).monospacedDigit().fontWeight(.medium)) \(parent.title)")
                    .lineLimit(1)
                if parent.external {
                    Text("external")
                        .font(.caption2)
                        .padding(.horizontal, 4)
                        .overlay(Capsule().strokeBorder(palette.muted, style: StrokeStyle(lineWidth: 1, dash: [2, 2])))
                }
            }
            .font(.caption)
            .foregroundStyle(palette.muted)
            .contentShape(.rect)
        }
        .buttonStyle(.borderless)
        .hoverEffect(.highlight)
        .accessibilityLabel("Sub-issue of \(parent.reference), \(parent.title)")
        .accessibilityHint(parentProblem.map { ProblemText($0).sentence } ?? "Opens the parent issue")
    }

    @ViewBuilder private var icon: some View {
        switch parent.unread {
        case .loading:
            ProgressView().controlSize(.mini)
        case .failed(.unavailable):
            Image(systemName: "lock.fill")
        case .failed:
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(palette.warning)
        case nil:
            Image(systemName: "arrow.turn.left.up")
        }
    }

    private var parentProblem: Problem? {
        if case .failed(let problem) = parent.unread { return problem }
        return nil
    }
}

extension ParentIssue {
    var route: IssueRoute { IssueRoute(id: id, reference: reference, title: title, url: url) }
}

/// The lines down from each level of parent issues to a row, through the
/// middle of their chevrons, so that a deep tree reads at a glance. Rows
/// touch top to bottom, so the lines run on from row to row.
private struct IndentGuides: View {
    @Environment(\.palette) private var palette
    var depth: Int

    var body: some View {
        if depth > 0 {
            Canvas { context, size in
                for level in 0..<depth {
                    let x = CGFloat(level) * RowStyle.indent + RowStyle.gutter / 2
                    context.fill(Path(CGRect(x: x - 0.5, y: 0, width: 1, height: size.height)), with: .color(palette.border))
                }
            }
            .frame(width: CGFloat(depth) * RowStyle.indent + RowStyle.gutter)
            .accessibilityHidden(true)
        }
    }
}

/// What a row offers on a long press, or a right click on an iPad: the
/// issue on GitHub, its link, sharing it, and its labels to filter by.
struct IssueRowMenu: View {
    @Environment(\.openURL) private var openURL
    let row: ListRow
    let controller: ListController

    var body: some View {
        if let mark = row.mark, !mark.match {
            Section {
                Text(
                    mark.mayMatch
                        ? "Context issue: the search results are incomplete, so it may match too."
                        : "Context issue: shown for its place in the tree.")
            }
        }
        if let url = row.issue.webURL {
            Section {
                Button("Open on GitHub", systemImage: "safari") { openURL(url) }
                Button("Copy Link", systemImage: "link") { controller.copyLink(url) }
                ShareLink(item: url, subject: Text(row.issue.title), message: Text(row.issue.qualifiedReference)) {
                    Label("Share…", systemImage: "square.and.arrow.up")
                }
            }
        }
        if !row.labels.isEmpty {
            Menu("Filter by Label", systemImage: "line.3.horizontal.decrease") {
                ForEach(row.labels) { label in
                    Button {
                        controller.filter(by: label)
                    } label: {
                        Label { Text(label.name) } icon: { LabelSwatch(label: label) }
                    }
                }
            }
        }
        if row.hasSubIssues {
            Button(
                row.expanded ? "Collapse Sub-issues" : "Expand Sub-issues",
                systemImage: row.expanded ? "chevron.down" : "chevron.right"
            ) {
                controller.setExpanded(row, !row.expanded)
            }
        }
        if case .failed = row.unread {
            Button("Retry", systemImage: "arrow.clockwise") { controller.retry() }
        }
    }
}

/// A row's swipe actions: GitHub and the link on the trailing edge, and
/// the sub-issues on the leading one.
struct IssueRowSwipes: ViewModifier {
    @Environment(\.openURL) private var openURL
    @Environment(\.palette) private var palette
    let row: ListRow
    let controller: ListController

    func body(content: Content) -> some View {
        content
            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                if let url = row.issue.webURL {
                    Button("GitHub", systemImage: "safari") { openURL(url) }
                        .tint(palette.primary)
                    Button("Copy Link", systemImage: "link") { controller.copyLink(url) }
                        .tint(.gray)
                }
            }
            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                if row.hasSubIssues {
                    Button(
                        row.expanded ? "Collapse" : "Expand",
                        systemImage: row.expanded ? "chevron.up" : "chevron.down"
                    ) {
                        controller.setExpanded(row, !row.expanded)
                    }
                    .tint(palette.accent)
                }
            }
    }
}
