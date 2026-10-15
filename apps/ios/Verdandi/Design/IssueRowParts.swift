import SwiftUI
import UIKit
import VerdandiKit

// The small parts of an issue row (`IssueRowContent`): its age, repository
// chip, labels, sub-issue progress, blocked-by and blocks counts, and what
// it says of an issue that has not been read. They follow the desktop's row
// (`row-cells.ts`), so that an issue reads the same on every device.

/// How long ago an issue was opened, closed or last updated, in the largest
/// whole unit, as `now`, `5m`, `3h`, `2d`, `4mo` or `1y`, as the desktop's
/// date column says it.
enum IssueAge {
    static func short(since date: Date, now: Date = .now) -> String {
        let seconds = now.timeIntervalSince(date)
        let units: [(TimeInterval, String)] = [
            (365 * 86400, "y"), (30 * 86400, "mo"), (86400, "d"), (3600, "h"), (60, "m"),
        ]
        for (size, unit) in units where seconds >= size {
            return "\(Int(seconds / size))\(unit)"
        }
        return "now"
    }
}

/// Which date of an issue a row says how long ago it was: the one its list
/// goes by in its sort order, as the desktop's date column does.
enum IssueDate: Equatable {
    case created, closed, updated

    /// What a list in a state goes by in a sort order: when each issue was
    /// opened, or in a closed list closed, or last updated.
    init(_ order: ListSortOrder, in state: IssueState) {
        switch order {
        case .newest: self = state == .closed ? .closed : .created
        case .updated: self = .updated
        }
    }

    /// The date of an issue, if it has one: an open issue was never closed.
    func of(_ issue: IssueInfo) -> Date? {
        switch self {
        case .created: issue.created
        case .closed: issue.closed
        case .updated: issue.updated
        }
    }

    /// What happened then, as VoiceOver says it.
    var verb: String {
        switch self {
        case .created: "Opened"
        case .closed: "Closed"
        case .updated: "Updated"
        }
    }

    /// The name of the sort order that goes by it.
    var sortOrderName: String {
        switch self {
        case .created: "Newest"
        case .closed: "Recently closed"
        case .updated: "Recently updated"
        }
    }
}

/// A ring filled as far as an issue's sub-issues are closed, with how many
/// of how many: GitHub's sub-issue progress.
struct SubIssueProgressBadge: View {
    @Environment(\.palette) private var palette
    var progress: SubIssueProgress

    var body: some View {
        let fraction = progress.total > 0 ? Double(progress.closed) / Double(progress.total) : 0
        HStack(spacing: 4) {
            ZStack {
                Circle().stroke(palette.muted.opacity(0.3), lineWidth: 2)
                Circle()
                    .trim(from: 0, to: fraction)
                    .stroke(palette.closed, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
            .frame(width: 10, height: 10)
            Text("\(progress.closed)/\(progress.total)")
                .monospacedDigit()
        }
        .font(.caption)
        .foregroundStyle(palette.muted)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(progress.closed) of \(progress.total) sub-issues closed")
    }
}

/// How many issues block an issue ("Blocked by", in red) or it blocks
/// ("Blocks", in amber): the open ones while they hold anything up, else a
/// muted `open/total`. Nothing waits on a closed issue, so its "Blocks"
/// reads `0/total`.
struct RelationshipBadge: View {
    enum Side { case blockedBy, blocking }

    @Environment(\.palette) private var palette
    var side: Side
    var count: RelationshipCount
    /// The state of the issue it counts for.
    var state: IssueState

    var body: some View {
        let live = state == .open && count.open > 0
        let waiting = side == .blocking && state == .closed ? 0 : count.open
        HStack(spacing: 3) {
            Image(systemName: symbol(live: live))
                .imageScale(.small)
            Text(live ? "\(count.open)" : "\(waiting)/\(count.total)")
                .monospacedDigit()
        }
        .font(.caption.weight(live ? .semibold : .regular))
        .foregroundStyle(live ? tint : palette.muted)
        .padding(.horizontal, live ? 6 : 0)
        .padding(.vertical, live ? 1 : 0)
        .background {
            if live {
                switch side {
                case .blockedBy: Capsule().fill(palette.blockedSurface)
                case .blocking: Capsule().strokeBorder(tint.opacity(0.8), lineWidth: 1)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "\(side == .blockedBy ? "Blocked by" : "Blocks") \(waiting) open of \(count.total)")
    }

    private var tint: Color { side == .blockedBy ? palette.blocked : palette.blocking }

    private func symbol(live: Bool) -> String {
        switch side {
        case .blockedBy: live ? "hand.raised.fill" : "hand.raised"
        case .blocking: live ? "arrowshape.right.fill" : "arrowshape.right"
        }
    }
}

/// The chip naming an issue's repository, as All and views show it: a
/// tracked repository's name filled in its owner's colour, or an external
/// repository's `owner/name`, outlined.
struct RowRepositoryChip: View {
    @Environment(\.palette) private var palette
    var repository: RepositoryAddress
    var external: Bool

    var body: some View {
        Text(external ? repository.nameWithOwner : repository.name)
            .font(.caption2.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 5)
            .padding(.vertical, 1.5)
            .foregroundStyle(external ? palette.muted : .white)
            .background {
                let shape = RoundedRectangle(cornerRadius: 4, style: .continuous)
                if external {
                    shape.strokeBorder(palette.muted, style: StrokeStyle(lineWidth: 1, dash: [2, 2]))
                } else {
                    shape.fill(OwnerColor.of(repository.owner))
                }
            }
            .accessibilityLabel(
                external
                    ? "\(repository.nameWithOwner), not a tracked repository"
                    : "Repository \(repository.nameWithOwner)")
    }
}

/// An owner's chip colour: always the same for one owner, whatever the case
/// of its name, far apart in hue from the others, and dark enough for white
/// text in light and dark alike. The same as the desktop's.
enum OwnerColor {
    private static let palette: [UInt32] = [
        0xb91c1c, 0xc2410c, 0xb45309, 0x4d7c0f, 0x15803d, 0x0f766e,
        0x0e7490, 0x1d4ed8, 0x4f46e5, 0x6d28d9, 0xa21caf, 0xbe185d,
    ]

    static func of(_ owner: String) -> Color {
        // FNV-1a, which spreads similar names apart.
        var hash: UInt32 = 0x811c_9dc5
        for scalar in owner.lowercased().unicodeScalars {
            hash = (hash ^ scalar.value) &* 0x0100_0193
        }
        let value = palette[Int(hash % UInt32(palette.count))]
        return Color(
            .sRGB, red: Double((value >> 16) & 0xff) / 255, green: Double((value >> 8) & 0xff) / 255,
            blue: Double(value & 0xff) / 255)
    }
}

/// A label in a row, which adds itself to the list's label filter when the
/// list has one to add to. A faint edge keeps a white label visible on a
/// light background, and a black one on a dark background.
struct RowLabel: View {
    @Environment(\.palette) private var palette
    var label: IssueLabel
    var onFilter: ((IssueLabel) -> Void)?

    var body: some View {
        if let onFilter {
            Button {
                onFilter(label)
            } label: {
                chip
            }
            .buttonStyle(.borderless)
            .hoverEffect(.highlight)
            .accessibilityLabel("Filter by \(label.name)")
        } else {
            chip
        }
    }

    private var chip: some View {
        LabelChip(label: label, compact: true)
            .overlay(Capsule().strokeBorder(palette.foreground.opacity(0.14), lineWidth: 0.5))
    }
}

/// `+N` for the labels a row leaves out: a menu of all of them, to filter
/// by, where the list has a label filter.
struct MoreLabels: View {
    @Environment(\.palette) private var palette
    var labels: [IssueLabel]
    var hidden: Int
    var onFilter: ((IssueLabel) -> Void)?

    var body: some View {
        let chip = Text("+\(hidden)")
            .font(.caption2.weight(.medium))
            .monospacedDigit()
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .foregroundStyle(palette.muted)
            .background(palette.muted.opacity(0.15), in: .capsule)
        if let onFilter {
            Menu {
                Section("Filter by Label") {
                    ForEach(labels) { label in
                        Button {
                            onFilter(label)
                        } label: {
                            Label { Text(label.name) } icon: { LabelSwatch(label: label) }
                        }
                    }
                }
            } label: {
                chip
            }
            .menuStyle(.button)
            .buttonStyle(.borderless)
            .hoverEffect(.highlight)
            .accessibilityLabel("\(hidden) more labels")
        } else {
            chip.accessibilityLabel("\(hidden) more labels")
        }
    }
}

/// A label's colour as a dot, for menus, which draw their icons in one
/// colour unless the image keeps its own.
struct LabelSwatch: View {
    var label: IssueLabel

    var body: some View {
        if let image = UIImage(systemName: "circle.fill")?
            .withTintColor(UIColor(label.swatch), renderingMode: .alwaysOriginal)
        {
            Image(uiImage: image)
        } else {
            Image(systemName: "circle.fill")
        }
    }
}

/// What a row says of an issue it shows only as a relationship names it:
/// that it loads, or why it could not be read.
struct UnreadNote: View {
    @Environment(\.palette) private var palette
    var unread: UnreadIssue

    var body: some View {
        switch unread {
        case .loading:
            HStack(spacing: 4) {
                ProgressView().controlSize(.mini)
                Text("Loading…")
            }
            .font(.caption)
            .foregroundStyle(palette.muted)
        case .failed(let problem):
            let unavailable = if case .unavailable = problem { true } else { false }
            Label(
                unavailable ? "Unavailable or not accessible" : "Could not be loaded",
                systemImage: unavailable ? "lock.fill" : "exclamationmark.triangle.fill"
            )
            .labelStyle(CompactLabelStyle())
            .font(.caption)
            .foregroundStyle(unavailable ? palette.muted : palette.warning)
            .accessibilityHint(ProblemText(problem).sentence)
        }
    }
}

extension Palette {
    /// The palette on the accent colour of a row the system selects
    /// prominently: text, icons and counts in white, so that they read on
    /// it as the system's own colours do. Labels and repository chips keep
    /// their colours, which carry their own backgrounds.
    var onAccent: Palette {
        let empty = Data(#"{"id":"on-accent","name":"On accent","kind":"dark","colors":{}}"#.utf8)
        guard var theme = theme ?? (try? JSONDecoder().decode(Theme.self, from: empty)) else { return self }
        for token in ["foreground", "issue-open", "issue-closed", "blocked", "blocking", "warning"] {
            theme.colors[token] = "#ffffff"
        }
        theme.colors["muted-foreground"] = "#ffffffcc"
        theme.colors["border"] = "#ffffff66"
        theme.colors["blocked-surface"] = "#ffffff33"
        return Palette(theme: theme)
    }
}

/// How the app says why something could not be read, as the desktop's
/// `problemText`: what GitHub will not show is "unavailable or not
/// accessible", never deleted or missing a permission, since only GitHub's
/// answer can say which; a reason and a link come only from it.
struct ProblemText: Equatable {
    /// A short sentence, e.g. "Cannot reach GitHub".
    var text: String
    /// More, in GitHub's own words.
    var detail: String?
    /// Where to act on it, when GitHub gave the link, e.g. to authorize SSO.
    var link: Link?

    struct Link: Equatable {
        var label: String
        var url: URL
    }

    init(_ problem: Problem, login: String? = nil, repository: RepositoryAddress? = nil) {
        switch problem {
        case .unreachable(let message):
            text = "Cannot reach GitHub"
            detail = message
        case .unavailable(let access, let issuesDisabled, let nameTakenOver):
            if nameTakenOver {
                let name = repository?.nameWithOwner ?? "Its name"
                text =
                    "\(name) now names a different repository. The one you tracked is unavailable or not accessible with this account."
            } else {
                text = "Unavailable or not accessible with this account\(login.map { " (@\($0))" } ?? "")"
                detail = issuesDisabled ? "Issues are turned off for this repository" : access?.message
                if case .sso(_, let url?) = access, let url = URL(string: url) {
                    link = Link(label: "Authorize on GitHub", url: url)
                }
            }
        case .interrupted:
            text = "Loading was interrupted"
        case .error(let message):
            text = message
        }
    }

    /// The text and its detail, as one sentence or two.
    var sentence: String {
        guard let detail, !detail.isEmpty else { return text }
        return "\(text). \(detail)"
    }
}
