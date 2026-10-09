import SwiftUI
import VerdandiKit

/// All: every tracked repository at once, with their open issues together.
struct AllEntryRow: View {
    var count: OpenIssueCount

    var body: some View {
        HStack {
            Label("All", systemImage: "square.stack.3d.up")
            Spacer(minLength: 8)
            OpenIssueBadge(count: count)
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(OpenIssueBadge.spoken(count))
    }
}

/// A tracked repository: its name, its owner below, and its open issues,
/// or why they cannot be shown. The icon says what is special about it:
/// archived, or unavailable to this account.
struct RepositoryEntryRow: View {
    @Environment(\.palette) private var palette
    var entry: RepositoryEntry
    var login: String?

    var body: some View {
        HStack {
            Label {
                VStack(alignment: .leading, spacing: 1) {
                    Text(entry.repository.name)
                        .lineLimit(1)
                    Text(owner)
                        .font(.caption)
                        .meaning(palette.muted)
                        .lineLimit(1)
                    if let reason {
                        Text(reason)
                            .font(.caption)
                            .meaning(palette.warning)
                            .lineLimit(2)
                    }
                }
                .opacity(entry.unavailable == nil ? 1 : 0.7)
            } icon: {
                Image(systemName: symbol)
                    .meaning(entry.unavailable == nil ? nil : palette.warning, selected: .primary)
                    .contentTransition(.symbolEffect(.replace))
            }
            Spacer(minLength: 8)
            if entry.unavailable == nil {
                OpenIssueBadge(count: entry.openIssues)
            }
        }
        .help(help)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(entry.repository.address.nameWithOwner)
        .accessibilityValue(spoken)
    }

    private var owner: String {
        entry.archived == true ? "\(entry.repository.owner) · Archived" : entry.repository.owner
    }

    /// What VoiceOver says of it besides its name.
    private var spoken: String {
        let archived = entry.archived == true ? "Archived" : nil
        return [archived, reason, OpenIssueBadge.spoken(entry.openIssues)].compactMap { $0 }.joined(separator: ", ")
    }

    private var symbol: String {
        if entry.unavailable != nil { return "exclamationmark.triangle.fill" }
        return entry.archived == true ? "archivebox" : "book.closed"
    }

    /// Why its issues cannot be shown, in a few words; the context menu
    /// says it in full.
    private var reason: String? {
        guard case .unavailable(_, let issuesDisabled, let nameTakenOver)? = entry.unavailable else { return nil }
        if nameTakenOver { return "Its name now belongs to another repository" }
        if issuesDisabled { return "Issues are turned off" }
        return "Unavailable or not accessible"
    }

    private var help: String {
        if let unavailable = entry.unavailable {
            return ReasonText(unavailable, login: login, repository: entry.repository.address).full
        }
        if case .failed(let message) = entry.openIssues { return message }
        return entry.repository.address.nameWithOwner
    }
}

/// A view: its name and how many issues its search matched when it last
/// ran, or that GitHub rejected it.
struct ViewEntryRow: View {
    @Environment(\.palette) private var palette
    var entry: ViewEntry

    var body: some View {
        HStack {
            Label {
                VStack(alignment: .leading, spacing: 1) {
                    Text(entry.view.name)
                        .lineLimit(1)
                    if rejected != nil {
                        Text("GitHub rejected this search")
                            .font(.caption)
                            .meaning(palette.warning)
                            .lineLimit(1)
                    }
                }
            } icon: {
                Image(systemName: symbol)
                    .meaning(rejected == nil ? nil : palette.warning, selected: .primary)
                    .contentTransition(.symbolEffect(.replace))
            }
            Spacer(minLength: 8)
            MatchCountBadge(matches: entry.matches)
        }
        .help(rejected.map { "GitHub rejected this search: \($0)" } ?? entry.view.query)
        .accessibilityElement(children: .combine)
        .accessibilityValue(spoken)
    }

    private var rejected: String? {
        if case .rejected(let message) = entry.matches { return message }
        return nil
    }

    private var symbol: String {
        rejected == nil ? "line.3.horizontal.decrease.circle" : "exclamationmark.triangle.fill"
    }

    private var spoken: String {
        switch entry.matches {
        case .unknown: "Not run yet"
        case .known(let count): "\(count) matches in the last run"
        case .rejected(let message): "GitHub rejected this search: \(message)"
        }
    }
}

/// An open-issue count as the sidebar shows it: rolling to its new value as
/// it arrives, a spinner while it is asked for, and a warning when asking
/// failed, so that a count not known never reads as 0.
struct OpenIssueBadge: View {
    @Environment(\.palette) private var palette
    var count: OpenIssueCount

    var body: some View {
        Group {
            switch count {
            case .loading:
                ProgressView()
                    .controlSize(.small)
                    .transition(.opacity)
            case .known(let count):
                SidebarCountText(count: count)
            case .failed:
                Image(systemName: "exclamationmark.triangle")
                    .font(.footnote)
                    .meaning(palette.warning)
                    .transition(.opacity)
            }
        }
        .animation(.smooth, value: count)
    }

    /// What VoiceOver says of a count.
    static func spoken(_ count: OpenIssueCount) -> String {
        switch count {
        case .loading: "Counting open issues"
        case .known(let count): count == 1 ? "1 open issue" : "\(count) open issues"
        case .failed(let message): "Open issues could not be counted. \(message)"
        }
    }
}

/// A view's match count: GitHub's total, abbreviated (4.2K), "–" until the
/// view has run in this session. A rejected search shows on its row.
struct MatchCountBadge: View {
    var matches: ViewMatchCount

    var body: some View {
        switch matches {
        case .known(let count):
            SidebarCountText(count: count, compact: true)
        case .unknown:
            Text("–")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Not run yet")
        case .rejected:
            EmptyView()
        }
    }
}

/// A count, rolling to its new value as it changes.
struct SidebarCountText: View {
    var count: Int
    /// Abbreviated, e.g. 4.2K, as a view may match many.
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
    /// Colours a part of a sidebar row by what it means, the tint when it
    /// means nothing special. On a selected row, which the selection
    /// colours, it takes the selection's text colour, as it would not read.
    fileprivate func meaning(_ color: Color?, selected: HierarchicalShapeStyle = .secondary) -> some View {
        modifier(Meaning(color: color, selected: selected))
    }
}

private struct Meaning: ViewModifier {
    @Environment(\.backgroundProminence) private var prominence
    var color: Color?
    var selected: HierarchicalShapeStyle

    func body(content: Content) -> some View {
        if prominence == .increased {
            content.foregroundStyle(selected)
        } else if let color {
            content.foregroundStyle(color)
        } else {
            content.foregroundStyle(.tint)
        }
    }
}
