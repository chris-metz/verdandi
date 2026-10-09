import SwiftUI
import VerdandiKit

/// The parts of the page a tap elsewhere on it can scroll to.
enum IssuePageAnchor: Hashable {
    case map, comments, end

    /// As `VERDANDI_SCROLL` names it.
    init?(launchName: String) {
        switch launchName {
        case "map": self = .map
        case "comments": self = .comments
        case "end": self = .end
        default: return nil
        }
    }
}

/// An issue's page: where it sits among its parent issues, its title and
/// metadata, what blocks it and what it blocks, its sub-issues, its body
/// and its comments.
///
/// It shows at once from what the list named the issue by, and fills in
/// as the core pushes the page: first the issue, then its relationships
/// and comments. What could not be read shows where it belongs, with a
/// way to read it again; pulling the page down reads it all again.
struct IssuePageScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.openURL) private var openURL
    let route: IssueRoute

    /// The sub-issues that show their own: the page's, not the core's, and
    /// none as the page opens.
    @State private var expanded: Set<String> = []
    /// Whether the big title is on screen; once it is not, the navigation
    /// bar names the issue.
    @State private var titleVisible = true
    @State private var filtered = 0
    @State private var copied = 0

    var body: some View {
        let page = model.pages[route.id]
        ScrollViewReader { proxy in
            ScrollView {
                content(page) { anchor in
                    withAnimation(.smooth) { proxy.scrollTo(anchor, anchor: .top) }
                }
            }
            .task(id: page?.comments?.loading) {
                // A launch option, to photograph a part of a page without
                // scrolling to it.
                guard let name = model.launch.scroll, let anchor = IssuePageAnchor(launchName: name),
                    case .current = page?.comments?.loading
                else { return }
                try? await Task.sleep(for: .seconds(2))
                proxy.scrollTo(anchor, anchor: anchor == .end ? .bottom : .top)
            }
        }
        .onChange(of: page?.subIssues, initial: true) {
            if model.launch.expandsSubIssues, let page = model.pages[route.id] {
                expanded = Set(SubIssuesSection.parents(in: page.subIssues))
            }
        }
        .background(palette.background)
        .refreshable { await refresh() }
        .navigationTitle(route.reference)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar(page) }
        .onChange(of: page?.issue?.id, initial: true) {
            if let issue = model.pages[route.id]?.issue { model.recordRecent(issue) }
        }
        .sensoryFeedback(.selection, trigger: filtered)
        .sensoryFeedback(.success, trigger: copied)
    }

    /// The page's margins: wider on an iPad's column than an iPhone's screen.
    private var margin: CGFloat { sizeClass == .regular ? 28 : 18 }

    // MARK: - Content

    @ViewBuilder
    private func content(_ page: IssuePage?, scrollTo: @escaping (IssuePageAnchor) -> Void) -> some View {
        let issue = page?.issue
        let failure: Problem? = if case .failed(let problem) = page?.loading, issue == nil { problem } else { nil }
        VStack(alignment: .leading, spacing: 30) {
            VStack(alignment: .leading, spacing: 18) {
                IssuePageHeader(
                    route: route, page: page,
                    // What GitHub no longer shows this account is not shown
                    // from before.
                    showsTitle: !(failure.map(isUnavailable) ?? false),
                    titleVisible: $titleVisible, scrollTo: scrollTo, filterByLabel: filter)
                if let failure {
                    VStack(alignment: .leading, spacing: 10) {
                        ProblemBanner(problem: failure) { Task { await model.retry() } }
                        if let url {
                            Link(destination: url) {
                                Label("Open on GitHub", systemImage: "safari")
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                } else if case .stale(_, let problem) = page?.loading {
                    ProblemBanner(problem: problem, stale: true) { Task { await model.retry() } }
                }
            }
            .issuePageColumn(margin: margin)

            if let page, let issue {
                if showsMap(issue: issue, map: page.blockingMap) {
                    BlockingMapSection(issueId: route.id, map: page.blockingMap, margin: margin)
                        .id(IssuePageAnchor.map)
                }
                if (issue.subIssueProgress?.total ?? 0) > 0 || !page.subIssues.isEmpty {
                    SubIssuesSection(issue: issue, page: page, expanded: $expanded)
                        .issuePageColumn(margin: margin)
                }
                IssueBodySection(issue: issue)
                    .issuePageColumn(margin: margin)
                IssueCommentsSection(issue: issue, comments: page.comments)
                    .issuePageColumn(margin: margin)
                    .id(IssuePageAnchor.comments)
            } else if failure == nil {
                IssueBodySection(issue: nil)
                    .issuePageColumn(margin: margin)
            }
            Color.clear.frame(height: 1).id(IssuePageAnchor.end)
        }
        .padding(.top, 8)
        .padding(.bottom, 40)
    }

    /// Whether the page shows the blocking map: once the issue blocks or is
    /// blocked by any other, or the map found any it could not read. An
    /// issue without either has nothing to map.
    private func showsMap(issue: IssueInfo, map: BlockingMap?) -> Bool {
        if (issue.blockedBy?.total ?? 0) + (issue.blocking?.total ?? 0) > 0 { return true }
        guard let map else { return false }
        return map.cards.count > 1 || !map.problems.isEmpty
    }

    private func isUnavailable(_ problem: Problem) -> Bool {
        if case .unavailable = problem { return true }
        return false
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private func toolbar(_ page: IssuePage?) -> some ToolbarContent {
        ToolbarItem(placement: .principal) {
            IssuePageTitle(
                title: page?.issue?.title ?? route.title,
                showsTitle: !titleVisible,
                loading: page?.loading)
        }
        if let url {
            ToolbarItemGroup(placement: .primaryAction) {
                Button("Open on GitHub", systemImage: "safari") { openURL(url) }
                    .keyboardShortcut("o", modifiers: .command)
                Menu {
                    ShareLink(item: url, subject: Text(page?.issue?.title ?? route.title)) {
                        Label("Share…", systemImage: "square.and.arrow.up")
                    }
                    Button("Copy Link", systemImage: "link") { copyLink(url, page: page) }
                        .keyboardShortcut("c", modifiers: [.command, .shift])
                    if let reference = page?.issue?.qualifiedReference {
                        Button("Copy Reference", systemImage: "number") {
                            GitHubLink.copy(reference)
                            copied += 1
                        }
                    }
                } label: {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
            }
        }
    }

    /// The issue's page on GitHub, as soon as it is known.
    private var url: URL? {
        (model.pages[route.id]?.issue?.url ?? route.url).flatMap(URL.init(string:))
    }

    private func copyLink(_ url: URL, page: IssuePage?) {
        GitHubLink.copy(url)
        copied += 1
        let reference = page?.issue?.qualifiedReference ?? route.reference
        model.post("Copied the link to \(reference).", systemImage: "link")
    }

    // MARK: - Acting

    /// Reads the page again, keeping the pull-to-refresh spinner until the
    /// core has: it reads in the background and pushes the page as it goes.
    private func refresh() async {
        await model.refresh()
        let clock = ContinuousClock()
        let start = clock.now
        var started = false
        while !Task.isCancelled, clock.now - start < .seconds(30) {
            let busy = model.pages[route.id]?.loading.isBusy ?? false
            if busy {
                started = true
            } else if started || clock.now - start > .seconds(1) {
                break
            }
            try? await Task.sleep(for: .milliseconds(100))
        }
    }

    /// Adds a label to the label filter of the list the page was opened
    /// from. On an iPhone, the list then shows instead of the page, as on
    /// the desktop app; on an iPad, it narrows beside the page.
    private func filter(by label: IssueLabel) {
        Task {
            guard await model.addToLabelFilter(label) else { return }
            filtered += 1
            if sizeClass == .compact {
                model.showList()
            } else {
                model.post(
                    "Added “\(label.name)” to the list’s label filter.",
                    systemImage: "line.3.horizontal.decrease.circle")
            }
        }
    }
}

/// The blocking map, once the page has it, and grey cards where it will be
/// until then. Its title lines up with the text; the map itself may run
/// wider on a wide iPad, as a wide figure does in an article.
private struct BlockingMapSection: View {
    let issueId: String
    let map: BlockingMap?
    let margin: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            IssuePageSectionHeader("Blocking map", systemImage: "point.3.connected.trianglepath.dotted")
                .issuePageColumn(margin: margin)
            Group {
                if let map {
                    BlockingMapView(map: map, issueId: issueId)
                } else {
                    HStack(spacing: 12) {
                        ForEach(0..<3, id: \.self) { _ in
                            PlaceholderLines(lines: 2, font: .subheadline)
                                .padding(12)
                                .frame(maxWidth: 220)
                                .issuePageCard()
                        }
                    }
                    .modifier(LoadingPulse())
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Loading the blocking map")
                }
            }
            .frame(maxWidth: 1200, alignment: .leading)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, margin)
        }
    }
}

/// The navigation bar's title: how current the page is, below the issue's
/// title once the big one has scrolled away. While that shows, the bar
/// does not repeat it, nor the reference above it.
private struct IssuePageTitle: View {
    @Environment(\.palette) private var palette
    let title: String
    let showsTitle: Bool
    let loading: LoadingState?

    var body: some View {
        VStack(spacing: 1) {
            if showsTitle {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(palette.foreground)
                    .lineLimit(1)
                    .transition(.opacity.combined(with: .offset(y: 8)))
            }
            FreshnessLine(loading: loading, prominent: !showsTitle)
        }
        .animation(.smooth(duration: 0.25), value: showsTitle)
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .accessibilityElement(children: .combine)
    }
}

/// How current the page is: "Updated 3 min ago", that it is read, or that
/// it shows what was read before.
private struct FreshnessLine: View {
    @Environment(\.palette) private var palette
    let loading: LoadingState?
    /// Larger when it is the bar's only line.
    var prominent = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            HStack(spacing: 4) {
                switch loading {
                case nil, .loading:
                    ProgressView().controlSize(.mini)
                    Text("Loading…")
                case .refreshing:
                    ProgressView().controlSize(.mini)
                    Text("Updating…")
                case .current(let updatedAt):
                    Text(IssuePageDates.updated(date(updatedAt), now: context.date))
                case .stale(let updatedAt, _), .partial(let updatedAt, _):
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(palette.warning)
                    Text("Showing data from \(IssuePageDates.time(of: date(updatedAt), now: context.date))")
                case .failed:
                    Text("Could not be loaded")
                }
            }
            .font(prominent ? .footnote.weight(.medium) : .caption2)
            .foregroundStyle(palette.muted)
            .lineLimit(1)
        }
    }

    private func date(_ milliseconds: Double) -> Date {
        Date(timeIntervalSince1970: milliseconds / 1000)
    }
}
