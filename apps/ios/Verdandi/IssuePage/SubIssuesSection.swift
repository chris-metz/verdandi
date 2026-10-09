import SwiftUI
import VerdandiKit

/// The issue's sub-issues as an outline: how many are closed, and each,
/// opening its page. Which ones show their own sub-issues is this page's
/// own, as the desktop app keeps it for each visit: all collapsed as the
/// page opens.
struct SubIssuesSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette
    let issue: IssueInfo
    let page: IssuePage
    @Binding var expanded: Set<String>

    var body: some View {
        let progress = issue.subIssueProgress
        // The bar says how many are closed; the title, how many there are.
        IssuePageSection(
            "Sub-issues", systemImage: "list.bullet.indent",
            count: progress.map { "\($0.total)" }
        ) {
            if hasNested {
                Button(allExpanded ? "Collapse All" : "Expand All") {
                    withAnimation(.snappy) { expanded = allExpanded ? [] : Set(Self.parents(in: page.subIssues)) }
                }
                .font(.subheadline)
                .buttonStyle(.borderless)
                .hoverEffect(.highlight)
            }
        } content: {
            VStack(alignment: .leading, spacing: 0) {
                if let progress, progress.total > 0 {
                    SubIssueProgressBar(progress: progress)
                        .padding(.horizontal, 16)
                        .padding(.top, 14)
                        .padding(.bottom, rows.isEmpty ? 14 : 6)
                }
                if rows.isEmpty {
                    emptyContent
                        .padding(16)
                } else {
                    let disclosures = hasNested
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 {
                            Divider()
                                .overlay(palette.border.opacity(0.6))
                                // Under the title, past the disclosure and the state icon.
                                .padding(.leading, 16 + indent(of: row) + (disclosures ? 52 : 30))
                        }
                        SubIssueRow(
                            node: row.node, indent: indent(of: row), disclosures: disclosures,
                            expanded: expanded.contains(row.id)
                        ) { isExpanded in
                            withAnimation(.snappy) {
                                if isExpanded { expanded.insert(row.id) } else { expanded.remove(row.id) }
                            }
                        }
                    }
                }
            }
            .issuePageCard()
            .sensoryFeedback(.selection, trigger: expanded)
        }
    }

    /// What shows when no sub-issue does: that they load, or why GitHub
    /// counts some it did not list, never "none".
    @ViewBuilder private var emptyContent: some View {
        if page.loading.isLoading {
            PlaceholderLines(lines: 2, font: .body)
                .modifier(LoadingPulse())
        } else if let incomplete = issue.incomplete {
            PartNotice(incomplete.message) {
                Button("Retry") { Task { await model.retry() } }
            }
        } else {
            PartNotice("GitHub did not list its sub-issues.") {
                Button("Retry") { Task { await model.retry() } }
            }
        }
    }

    struct Row: Identifiable {
        var node: IssueNode
        var depth: Int
        var id: String { node.id }
    }

    /// The outline as it shows: each sub-issue, and below an expanded one
    /// its own.
    private var rows: [Row] {
        func flatten(_ nodes: [IssueNode], depth: Int) -> [Row] {
            nodes.flatMap { node in
                [Row(node: node, depth: depth)]
                    + (expanded.contains(node.id) ? flatten(node.subIssues, depth: depth + 1) : [])
            }
        }
        return flatten(page.subIssues, depth: 0)
    }

    /// How far a row is indented: less on each level past the fourth, so
    /// that deep outlines still fit an iPhone.
    private func indent(of row: Row) -> CGFloat {
        CGFloat(min(row.depth, 4)) * 20 + CGFloat(max(0, row.depth - 4)) * 6
    }

    private var hasNested: Bool {
        page.subIssues.contains { !$0.subIssues.isEmpty }
    }

    private var allExpanded: Bool {
        let parents = Self.parents(in: page.subIssues)
        return !parents.isEmpty && parents.allSatisfy(expanded.contains)
    }

    /// Every issue in the outline with sub-issues of its own.
    static func parents(in nodes: [IssueNode]) -> [String] {
        nodes.flatMap { node in
            node.subIssues.isEmpty ? [] : [node.id] + parents(in: node.subIssues)
        }
    }
}

/// How many sub-issues are closed, of all, as a bar.
private struct SubIssueProgressBar: View {
    @Environment(\.palette) private var palette
    let progress: SubIssueProgress

    var body: some View {
        HStack(spacing: 10) {
            ProgressView(value: Double(progress.closed), total: Double(max(progress.total, 1)))
                .progressViewStyle(.linear)
                .tint(palette.closed)
            Text("\(progress.closed) of \(progress.total) closed")
                .font(.footnote.monospacedDigit())
                .foregroundStyle(palette.muted)
                .fixedSize()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(progress.closed) of \(progress.total) sub-issues closed")
    }
}

/// One sub-issue: a disclosure for its own sub-issues, and the issue as a
/// row shows it, which opens its page.
private struct SubIssueRow: View {
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette
    @Environment(\.openURL) private var openURL
    let node: IssueNode
    let indent: CGFloat
    /// Whether the outline has a column for disclosures: only when any of
    /// its sub-issues has sub-issues of its own.
    let disclosures: Bool
    let expanded: Bool
    var toggle: (Bool) -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            if disclosures { disclosure }
            Button {
                model.openIssue(IssueRoute(node.issue), fromPage: true)
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    IssueRowContent(issue: node.issue, unread: node.unread)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.forward")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(palette.muted.opacity(0.6))
                        .accessibilityHidden(true)
                }
                .padding(.vertical, 11)
                .padding(.trailing, 14)
                .contentShape(.rect)
            }
            .buttonStyle(RowButtonStyle())
            // VoiceOver reads the row as one, and expands it by its actions.
            .accessibilityValue(hasSubIssues ? (expanded ? "Sub-issues shown" : "Sub-issues hidden") : "")
            .accessibilityAction(named: expanded ? "Hide Sub-issues" : "Show Sub-issues") {
                if hasSubIssues { toggle(!expanded) }
            }
        }
        .padding(.leading, (disclosures ? 12 : 16) + indent)
        .hoverEffect(.highlight)
        .contextMenu { menu }
    }

    private var hasSubIssues: Bool { !node.subIssues.isEmpty }

    @ViewBuilder private var disclosure: some View {
        if hasSubIssues {
            Button {
                toggle(!expanded)
            } label: {
                Text(Image(systemName: "chevron.forward"))
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(palette.muted)
                    .rotationEffect(.degrees(expanded ? 90 : 0))
                    .frame(width: 22)
                    .padding(.vertical, 11)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHidden(true)
        } else {
            Color.clear.frame(width: 22, height: 1)
        }
    }

    @ViewBuilder private var menu: some View {
        Button("Open", systemImage: "arrow.right.circle") {
            model.openIssue(IssueRoute(node.issue), fromPage: true)
        }
        if hasSubIssues {
            Button(
                expanded ? "Hide Sub-issues" : "Show Sub-issues",
                systemImage: expanded ? "chevron.up" : "chevron.down"
            ) { toggle(!expanded) }
        }
        if let url = URL(string: node.issue.url) {
            Button("Open on GitHub", systemImage: "safari") { openURL(url) }
            Button("Copy Link", systemImage: "link") { GitHubLink.copy(url) }
        }
        if case .failed = node.unread {
            Button("Retry", systemImage: "arrow.clockwise") { Task { await model.retry() } }
        }
    }
}

/// A row that darkens a little while it is pressed.
struct RowButtonStyle: ButtonStyle {
    @Environment(\.palette) private var palette

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(palette.foreground.opacity(configuration.isPressed ? 0.06 : 0))
    }
}
