import SwiftUI
import VerdandiKit

/// The page's top: the parent issues above the issue, its reference and
/// title, and its metadata once it has been read. Before then it shows
/// the reference and title the list named it by, and grey stand-ins for
/// the rest.
struct IssuePageHeader: View {
    @Environment(\.palette) private var palette
    @Environment(\.horizontalSizeClass) private var sizeClass
    let route: IssueRoute
    let page: IssuePage?
    /// Whether the title shows: not for an issue GitHub no longer shows
    /// this account, which is not shown from before.
    var showsTitle = true
    /// Whether the title is on screen, for the navigation bar to name the
    /// issue once it is not.
    @Binding var titleVisible: Bool
    var scrollTo: (IssuePageAnchor) -> Void
    var filterByLabel: (IssueLabel) -> Void

    var body: some View {
        let issue = page?.issue
        VStack(alignment: .leading, spacing: 14) {
            if let page, !page.ancestry.isEmpty {
                AncestryView(ancestry: page.ancestry, repository: issue?.repository)
            }
            VStack(alignment: .leading, spacing: 6) {
                ReferenceLine(route: route, issue: issue)
                if showsTitle {
                    Text(issue?.title ?? route.title)
                        .font(sizeClass == .regular ? .title.weight(.bold) : .title2.weight(.bold))
                        .foregroundStyle(palette.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                        .accessibilityAddTraits(.isHeader)
                        .onScrollVisibilityChange(threshold: 0.2) { titleVisible = $0 }
                }
            }
            if let issue {
                IssueMetadataView(issue: issue, scrollTo: scrollTo, filterByLabel: filterByLabel)
            } else if page?.loading.problem == nil {
                MetadataPlaceholder()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Ancestry

/// The parent issue, its parent and so on, top-most first, each opening
/// its page. A parent that has not been read ends it, with why: what lies
/// above it is unknown.
private struct AncestryView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette
    let ancestry: [ParentIssue]
    /// The issue's repository, in which a parent is named by its number alone.
    let repository: RepositoryAddress?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            FlowLayout(spacing: 4, lineSpacing: 6) {
                if ancestry.first?.unread != nil {
                    // Above a parent that has not been read, nothing is known.
                    Text("…")
                        .foregroundStyle(palette.muted)
                        .accessibilityHidden(true)
                    separator
                }
                ForEach(Array(ancestry.enumerated()), id: \.element.id) { index, parent in
                    if index > 0 { separator }
                    Crumb(parent: parent, reference: shortReference(of: parent))
                }
            }
            if let failed = ancestry.first(where: { $0.unread.isFailed }), case .failed(let problem) = failed.unread {
                PartNotice("The parent issue could not be loaded. \(problem.message)") {
                    Button("Retry") { Task { await model.retry() } }
                    if let url = failed.url.flatMap(URL.init(string:)) {
                        Link("Open on GitHub", destination: url)
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Parent issues")
    }

    private var separator: some View {
        Image(systemName: "chevron.forward")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(palette.muted.opacity(0.7))
            .accessibilityHidden(true)
    }

    /// `#12` for a parent in the issue's repository, which the line below
    /// names; `owner/name#12` for one elsewhere.
    private func shortReference(of parent: ParentIssue) -> String {
        guard let repository, let hash = parent.reference.lastIndex(of: "#"),
            let address = RepositoryAddress(parsing: String(parent.reference[..<hash])),
            address.sameRepository(as: repository)
        else { return parent.reference }
        return String(parent.reference[hash...])
    }
}

/// One parent issue in the breadcrumb, which opens its page.
private struct Crumb: View {
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette
    @Environment(\.openURL) private var openURL
    let parent: ParentIssue
    /// How the crumb names it: by its number alone in the issue's repository.
    let reference: String

    var body: some View {
        Button {
            model.openIssue(route, fromPage: true)
        } label: {
            HStack(spacing: 5) {
                switch parent.unread {
                case .loading:
                    ProgressView().controlSize(.mini)
                case .failed:
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(palette.warning)
                case nil:
                    Image(systemName: "arrow.turn.left.up")
                        .foregroundStyle(palette.muted)
                }
                Text(reference)
                    .monospacedDigit()
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
                    .layoutPriority(1)
                Text(parent.title)
                    .foregroundStyle(palette.foreground)
                    .lineLimit(1)
            }
            .font(.subheadline)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .frame(maxWidth: 340, alignment: .leading)
            .background(palette.muted.opacity(0.1), in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .opacity(parent.unread == nil ? 1 : 0.75)
        .contextMenu {
            Button("Open", systemImage: "arrow.right.circle") { model.openIssue(route, fromPage: true) }
            if let url = parent.url.flatMap(URL.init(string:)) {
                Button("Open on GitHub", systemImage: "safari") { openURL(url) }
                Button("Copy Link", systemImage: "link") { GitHubLink.copy(url) }
            }
        }
        .accessibilityLabel("Parent issue \(parent.reference): \(parent.title)\(unreadText)")
    }

    private var route: IssueRoute {
        IssueRoute(id: parent.id, reference: parent.reference, title: parent.title, url: parent.url)
    }

    private var unreadText: String {
        switch parent.unread {
        case .loading: ", loading"
        case .failed(let problem): ". \(problem.message)"
        case nil: ""
        }
    }
}

extension UnreadIssue? {
    var isFailed: Bool {
        if case .failed = self { return true }
        return false
    }
}

// MARK: - Reference

/// Where the issue lives, `owner/name#12`, and whether it is an external
/// issue or GitHub showed it only in part.
private struct ReferenceLine: View {
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette
    let route: IssueRoute
    let issue: IssueInfo?
    @State private var showsIncomplete = false

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "book.closed")
                .imageScale(.small)
            Text(reference)
                .monospacedDigit()
                .textSelection(.enabled)
            if issue?.external == true {
                Text("External")
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .overlay(Capsule().strokeBorder(palette.border))
                    .accessibilityLabel("External issue, outside your tracked repositories")
            }
            if let incomplete = issue?.incomplete {
                Button {
                    showsIncomplete = true
                } label: {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(palette.warning)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Shown in part")
                .popover(isPresented: $showsIncomplete) {
                    PartNotice("GitHub showed this issue only in part. \(incomplete.message)") {
                        Button("Retry") {
                            showsIncomplete = false
                            Task { await model.retry() }
                        }
                    }
                    .padding()
                    .frame(idealWidth: 320)
                    .presentationCompactAdaptation(.popover)
                }
            }
        }
        .font(.subheadline)
        .foregroundStyle(palette.muted)
    }

    /// `owner/name#12` once the issue has been read; until then, as the
    /// list named it.
    private var reference: String {
        issue?.qualifiedReference ?? route.reference
    }
}

// MARK: - Metadata

/// The issue's state and blocking relationships, its labels, who opened it
/// and when, its comments, assignees and milestone, wrapping as the page
/// narrows.
private struct IssueMetadataView: View {
    @Environment(\.palette) private var palette
    @ScaledMetric(relativeTo: .subheadline) private var avatarSize: CGFloat = 22
    let issue: IssueInfo
    var scrollTo: (IssuePageAnchor) -> Void
    var filterByLabel: (IssueLabel) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            FlowLayout(spacing: 8, lineSpacing: 8) {
                StatePill(state: issue.state, reason: issue.stateReason)
                RelationshipPill(side: .blockedBy, state: issue.state, count: issue.blockedBy) { scrollTo(.map) }
                RelationshipPill(side: .blocking, state: issue.state, count: issue.blocking) { scrollTo(.map) }
                ForEach(issue.labels ?? []) { label in
                    Button {
                        filterByLabel(label)
                    } label: {
                        // As tall as the pills beside it.
                        LabelChip(label: label)
                            .padding(.vertical, 2)
                            .contentShape(.capsule)
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.lift)
                    .accessibilityHint("Adds it to the list's label filter")
                    .contextMenu {
                        Button("Filter the List by “\(label.name)”", systemImage: "line.3.horizontal.decrease.circle") {
                            filterByLabel(label)
                        }
                        Button("Copy Label Name", systemImage: "doc.on.doc") { GitHubLink.copy(label.name) }
                    }
                }
            }
            FlowLayout(spacing: 14, lineSpacing: 8) {
                HStack(spacing: 7) {
                    AvatarView(actor: issue.author, size: avatarSize)
                    authorText
                }
                .accessibilityElement(children: .combine)
                if let count = issue.commentCount {
                    Button {
                        scrollTo(.comments)
                    } label: {
                        Label(count == 1 ? "1 comment" : "\(count) comments", systemImage: "bubble.left.and.bubble.right")
                            .labelStyle(CompactLabelStyle())
                            .contentTransition(.numericText())
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                    .accessibilityHint("Shows the comments")
                }
                if let assignees = issue.assignees, !assignees.isEmpty {
                    AssigneesView(assignees: assignees, size: avatarSize)
                }
                if let milestone = issue.milestone {
                    Label(milestone, systemImage: "signpost.right")
                        .labelStyle(CompactLabelStyle())
                        .accessibilityLabel("Milestone \(milestone)")
                }
            }
            .font(.subheadline)
            .foregroundStyle(palette.muted)
        }
        .animation(.smooth, value: issue.commentCount)
    }

    @ViewBuilder private var authorText: some View {
        let login = Text(issue.author.map { "@\($0.login)" } ?? "Deleted user")
            .fontWeight(.semibold)
            .foregroundStyle(palette.foreground)
        if let created = issue.created {
            TimelineView(.periodic(from: .now, by: 60)) { context in
                Text("\(login) opened \(IssuePageDates.age(of: created, now: context.date))")
            }
            .accessibilityLabel(
                "\(issue.author.map { "@\($0.login)" } ?? "Deleted user") opened it on \(IssuePageDates.full(created))")
        } else {
            Text("\(login) opened it")
        }
    }
}

/// Whether an issue is open or closed, and why, in the theme's colours.
private struct StatePill: View {
    @Environment(\.palette) private var palette
    let state: IssueState
    let reason: StateReason?

    var body: some View {
        HStack(spacing: 5) {
            StateIcon(state: state, reason: reason)
                .foregroundStyle(color)
            Text(title)
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(color)
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(color.opacity(0.14), in: .capsule)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
    }

    private var title: String {
        switch (state, reason) {
        case (.open, _): "Open"
        case (.closed, .notPlanned): "Closed as not planned"
        case (.closed, .duplicate): "Duplicate"
        case (.closed, _): "Closed"
        }
    }

    private var color: Color {
        switch (state, reason) {
        case (.open, _): palette.open
        case (.closed, .notPlanned), (.closed, .duplicate): palette.muted
        case (.closed, _): palette.closed
        }
    }
}

/// How many issues block this one, or how many it blocks, as the desktop
/// app's page says it: an open issue with open blockers is "Blocked by 2"
/// in red, one that blocks open issues "Blocks 3" in amber; otherwise how
/// many are open of all, quietly. None for a side without any. A tap
/// shows the blocking map.
private struct RelationshipPill: View {
    @Environment(\.palette) private var palette
    let side: BlockingSide
    let state: IssueState
    let count: RelationshipCount?
    var action: () -> Void

    var body: some View {
        if let count, count.total > 0 {
            let live = state == .open && count.open > 0
            // A closed issue keeps no one waiting.
            let waiting = side == .blocking && state == .closed ? 0 : count.open
            let text = live ? "\(count.open)" : "\(waiting)/\(count.total)"
            let color = side == .blockedBy ? palette.blocked : palette.blocking
            Button(action: action) {
                HStack(spacing: 5) {
                    Image(systemName: side == .blockedBy ? "arrow.down.left.circle" : "arrow.up.right.circle")
                        .symbolVariant(live ? .fill : .none)
                    Text(side == .blockedBy ? "Blocked by" : "Blocks")
                    Text(text).monospacedDigit()
                }
                .font(.footnote.weight(.medium))
                .foregroundStyle(live ? color : palette.muted)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(live && side == .blockedBy ? palette.blockedSurface : .clear, in: .capsule)
                .overlay(Capsule().strokeBorder(live ? color.opacity(side == .blockedBy ? 0.35 : 0.8) : palette.border))
                .contentShape(.capsule)
            }
            .buttonStyle(.plain)
            .hoverEffect(.lift)
            .accessibilityLabel(
                "\(side == .blockedBy ? "Blocked by" : "Blocks") \(count.open) open of \(count.total)")
            .accessibilityHint("Shows the blocking map")
        }
    }
}

/// Who the issue is assigned to, their pictures overlapping.
private struct AssigneesView: View {
    @Environment(\.palette) private var palette
    let assignees: [IssueActor]
    let size: CGFloat

    var body: some View {
        HStack(spacing: 6) {
            Text("Assigned to")
            HStack(spacing: -size * 0.3) {
                ForEach(assignees.prefix(5), id: \.login) { assignee in
                    AvatarView(actor: assignee, size: size)
                        .overlay(Circle().strokeBorder(palette.background, lineWidth: 1.5))
                }
            }
            if let only = assignees.first, assignees.count == 1 {
                Text("@\(only.login)")
                    .fontWeight(.semibold)
                    .foregroundStyle(palette.foreground)
            } else if assignees.count > 5 {
                Text("+\(assignees.count - 5)").monospacedDigit()
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Assigned to " + assignees.map { "@\($0.login)" }.formatted(.list(type: .and)))
    }
}

/// Grey pills and a line where the metadata will be, while the issue is read.
private struct MetadataPlaceholder: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text("Open").padding(.horizontal, 10).padding(.vertical, 4)
                    .background(.quaternary, in: .capsule)
                Text("Blocked by 0").padding(.horizontal, 10).padding(.vertical, 4)
                    .background(.quaternary, in: .capsule)
            }
            .font(.footnote.weight(.semibold))
            Text("@someone opened a few days ago · 3 comments")
                .font(.subheadline)
        }
        .redacted(reason: .placeholder)
        .modifier(LoadingPulse())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading the issue")
    }
}
