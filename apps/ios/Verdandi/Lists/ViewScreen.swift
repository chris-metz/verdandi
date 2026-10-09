import SwiftUI
import VerdandiKit

/// A view's screen: the issues its search matches, from any repository,
/// each under its ancestry with the context issues around it, each row with
/// its repository's chip. It expands, collapses and filters by label as a
/// list does.
///
/// Its search shows above the matches, and opens the view editor; the title
/// counts the matches as GitHub does, or how far the search has run.
/// Notices say what the matches leave out. A search GitHub failed says why
/// in place of the matches, in GitHub's words, with Edit View.
struct ViewScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @Environment(\.palette) private var palette
    let viewId: String
    @State private var controller: ListController
    @State private var now = Date.now

    init(viewId: String) {
        self.viewId = viewId
        _controller = State(initialValue: ListController(list: .view(id: viewId)))
    }

    var body: some View {
        let list = model.views[viewId]
        let rows = controller.rows(of: list?.trees ?? [])
        Group {
            if let list, let problem = list.searchProblem, !isTooLarge(problem) || rows.isEmpty {
                // GitHub rejects the search whatever it matched before.
                ScrollView {
                    SearchFailure(problem: problem, query: list.query, edit: edit, retry: controller.retry)
                }
                .background(palette.background)
            } else {
                ForestList(
                    rows: rows,
                    style: RowStyle(listState: nil, showsRepository: true),
                    controller: controller,
                    labelFilter: list?.labelFilter ?? []
                ) {
                    if let view = savedView { SearchSummary(query: view.query, edit: edit) }
                    if let list { notices(list, rows: rows) }
                } footer: {
                    if let list, !rows.isEmpty { ListFooter(text: footer(list)) }
                }
                .overlay {
                    if rows.isEmpty { placeholder(list) }
                }
                .refreshable {
                    await controller.refresh {
                        guard let view = model.views[viewId] else { return false }
                        return view.loading.isBusy || view.readingContext
                    }
                }
            }
        }
        .navigationTitle(savedView?.name ?? "View")
        .navigationSubtitle(subtitle(list))
        .toolbar { toolbar(list) }
        .onAppear { controller.model = model }
        .task {
            controller.model = model
            await ListLaunchOptions.apply(to: controller, model: model)
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                now = .now
            }
        }
    }

    /// The view as the core pushed it, or as the sidebar lists it until then.
    private var savedView: SavedView? {
        if let view = model.views[viewId]?.view { return view }
        if case .read(let entries) = model.sidebar {
            return entries.views.first { $0.view.id == viewId }?.view
        }
        return nil
    }

    private func edit() {
        guard let savedView else { return }
        model.editedView = savedView
        model.sheet = .newView
    }

    private func isTooLarge(_ problem: SearchProblem) -> Bool {
        if case .tooLarge = problem { return true }
        return false
    }

    // MARK: - Title and toolbar

    private func subtitle(_ list: ViewList?) -> String {
        guard let list else { return "Searching…" }
        var parts = [ListWording.counts(list)]
        if case .loading = list.loading {
        } else if !list.readingContext, let freshness = ListWording.freshness(list.loading, now: now) {
            parts.append(freshness)
        }
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// The line under the matches: how many GitHub counts, and how many of
    /// them carry every label of the label filter.
    private func footer(_ list: ViewList) -> String {
        var parts: [String] = []
        if let matchCount = list.matchCount {
            parts.append(ListWording.matches(matchCount: matchCount, pullRequests: list.pullRequests, listed: list.inScope))
        }
        if !list.labelFilter.isEmpty, list.inScope > 0 {
            parts.append(
                ListWording.labelFilterStatus(matches: list.matchesShown, inScope: list.inScope, labels: list.labelFilter))
        }
        return parts.joined(separator: "\n")
    }

    @ToolbarContentBuilder
    private func toolbar(_ list: ViewList?) -> some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Menu {
                Button("Edit View…", systemImage: "pencil", action: edit)
                    .disabled(savedView == nil)
                Section {
                    Button("Expand All", systemImage: "rectangle.expand.vertical") { controller.setAllExpanded(true) }
                    Button("Collapse All", systemImage: "rectangle.compress.vertical") {
                        controller.setAllExpanded(false)
                    }
                }
                .disabled(!(list?.trees.contains { !$0.subIssues.isEmpty } ?? false))
                if !(list?.labelFilter.isEmpty ?? true) {
                    Button("Clear Label Filter", systemImage: "line.3.horizontal.decrease.circle") {
                        controller.clearFilter()
                    }
                }
                Section {
                    Button("Refresh", systemImage: "arrow.clockwise") {
                        Task { await controller.refresh { false } }
                    }
                    if let url = savedView.flatMap({ Self.searchURL($0.query) }) {
                        Button("Search on GitHub", systemImage: "safari") { openURL(url) }
                    }
                }
            } label: {
                Label("More", systemImage: "ellipsis")
            }
        }
    }

    /// The view's search on github.com.
    static func searchURL(_ query: String) -> URL? {
        var components = URLComponents(string: "https://github.com/issues")
        components?.queryItems = [URLQueryItem(name: "q", value: query)]
        return components?.url
    }

    // MARK: - Notices

    @ViewBuilder
    private func notices(_ list: ViewList, rows: [ListRow]) -> some View {
        ForEach(ViewStrip.of(list), id: \.self) { strip in
            ListNotice(
                tone: strip.retry ? .warning : .info,
                systemImage: strip.retry ? "exclamationmark.triangle" : "info.circle",
                text: strip.text, detail: strip.hint
            ) {
                if strip.retry { Button("Retry") { controller.retry() } }
            }
        }
        switch list.loading {
        case .stale(let at, let problem):
            ListNotice(
                systemImage: "clock.arrow.trianglehead.counterclockwise.rotate.90",
                text: "Showing data from \(ListWording.timeOf(Date(timeIntervalSince1970: at / 1000), now: now))",
                detail: ProblemText(problem, login: model.setup.account?.login).sentence
            ) {
                Button("Retry") { controller.retry() }
            }
        case .failed(let problem) where !rows.isEmpty:
            ListNotice(
                systemImage: "exclamationmark.triangle", text: "The search could not be run again",
                detail: ProblemText(problem, login: model.setup.account?.login).sentence
            ) {
                Button("Retry") { controller.retry() }
            }
        default:
            EmptyView()
        }
        let missing =
            ListWording.missing(trees: list.trees, named: [])
            + ListWording.countFailures(
                list.trees.compactMap { tree in
                    if case .failed(let problem) = tree.missingParent { problem } else { nil }
                }, one: "parent issue", many: "parent issues")
        if !missing.isEmpty {
            ListNotice(systemImage: "exclamationmark.triangle", text: missing.joined(separator: " · ")) {
                Button("Retry") { controller.retry() }
            }
        }
    }

    // MARK: - In place of the matches

    @ViewBuilder
    private func placeholder(_ list: ViewList?) -> some View {
        if let list {
            switch list.loading {
            case .loading:
                ListLoadingView(title: ListWording.counts(list), progress: nil)
            case .failed(let problem):
                ListProblem(
                    title: "Could Not Search", problem: problem, login: model.setup.account?.login,
                    url: Self.searchURL(list.query), retry: controller.retry)
            default:
                if list.inScope == 0 {
                    NoSearchMatches(edit: edit)
                } else if !list.labelFilter.isEmpty {
                    NoLabelMatches(
                        text: ListWording.labelFilterStatus(
                            matches: list.matchesShown, inScope: list.inScope, labels: list.labelFilter),
                        clear: controller.clearFilter)
                }
            }
        } else {
            ListLoadingView(title: "Searching…", progress: nil)
        }
    }
}

/// The view's search, above its matches, which opens the view editor.
private struct SearchSummary: View {
    @Environment(\.palette) private var palette
    var query: String
    var edit: () -> Void

    var body: some View {
        Button(action: edit) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(palette.muted)
                Text(query)
                    .font(.callout.monospaced())
                    .foregroundStyle(palette.foreground)
                    .multilineTextAlignment(.leading)
                    .lineLimit(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "pencil")
                    .foregroundStyle(palette.muted)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(palette.muted.opacity(0.12), in: .rect(cornerRadius: 12, style: .continuous))
            .contentShape(.rect)
        }
        .buttonStyle(.borderless)
        .hoverEffect(.highlight)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 6, trailing: 16))
        .listRowBackground(Color.clear)
        .selectionDisabled()
        .accessibilityLabel("Search: \(query)")
        .accessibilityHint("Edits the view")
    }
}

/// Why GitHub failed a view's search, in place of its matches: GitHub's own
/// message when it rejected the search or cannot search what it names,
/// which only editing the search mends, and a hint that it may be too large
/// when GitHub failed it with an empty HTTP 500.
private struct SearchFailure: View {
    @Environment(\.palette) private var palette
    var problem: SearchProblem
    var query: String
    var edit: () -> Void
    var retry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: symbol)
                .font(.system(size: 44))
                .foregroundStyle(palette.warning)
                .symbolRenderingMode(.hierarchical)
            Text(title)
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)
            switch problem {
            case .invalid(let message):
                GitHubMessage(message: message)
                Text("It is not run again until the search changes.")
            case .unsearchable(let message):
                GitHubMessage(message: message)
                Text("Check the repo:, org: and user: qualifiers.")
            case .tooLarge:
                Text("HTTP 500 with an empty body. GitHub answers very long searches this way, so the search may be too large.")
            }
            HStack(spacing: 12) {
                if case .tooLarge = problem {
                    Button("Retry", action: retry)
                        .buttonStyle(.glass)
                }
                Button("Edit View", systemImage: "pencil", action: edit)
                    .buttonStyle(.glassProminent)
            }
            .padding(.top, 4)
        }
        .font(.callout)
        .foregroundStyle(palette.muted)
        .multilineTextAlignment(.center)
        .frame(maxWidth: 480)
        .padding(24)
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }

    private var title: String {
        switch problem {
        case .invalid: "GitHub rejected this search"
        case .unsearchable: "GitHub can't search a repository or user in this view"
        case .tooLarge: "GitHub returned an error"
        }
    }

    private var symbol: String {
        switch problem {
        case .invalid: "exclamationmark.magnifyingglass"
        case .unsearchable: "questionmark.folder"
        case .tooLarge: "exclamationmark.triangle"
        }
    }
}

/// GitHub's own words, as it said them.
private struct GitHubMessage: View {
    @Environment(\.palette) private var palette
    var message: String

    var body: some View {
        Text(message)
            .font(.footnote.monospaced())
            .foregroundStyle(palette.foreground)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(palette.card, in: .rect(cornerRadius: 12, style: .continuous))
            .textSelection(.enabled)
    }
}

/// What a view shows when its search found nothing, with why that may be.
private struct NoSearchMatches: View {
    var edit: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("No Matching Issues", systemImage: "magnifyingglass")
        } description: {
            VStack(spacing: 8) {
                Text("GitHub found nothing for this search.")
                Text(
                    "GitHub silently ignores qualifiers it doesn't know: a typo such as lable:bug returns nothing, without an error. Inside an OR group, repositories you can't read are dropped without notice."
                )
                .font(.footnote)
            }
        } actions: {
            Button("Edit View", systemImage: "pencil", action: edit)
                .buttonStyle(.glass)
        }
    }
}
