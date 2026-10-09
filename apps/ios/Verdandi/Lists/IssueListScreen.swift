import SwiftUI
import VerdandiKit

/// A scope's list, All's or a tracked repository's: its issues in the state
/// chosen, open or closed, as a forest of sub-issues, each under its parent
/// issue whichever tracked repository either lives in.
///
/// The navigation bar switches between open and closed, and its menu
/// expands or collapses everything; the title counts the issues and says
/// how current they are. Notices above the issues say what could not be
/// read, with Retry; pulling the list down reads it again.
struct IssueListScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let scope: Scope
    @State private var controller: ListController
    /// The state asked for, shown until the core pushes the list in it.
    @State private var requestedState: IssueState?
    /// The time "Updated … ago" counts from, a little behind the clock.
    @State private var now = Date.now
    @State private var confirmsRemoval = false

    init(scope: Scope) {
        self.scope = scope
        _controller = State(initialValue: ListController(list: .scope(scope)))
    }

    var body: some View {
        let list = model.list(for: scope)
        let rows = controller.rows(of: list?.trees ?? [])
        Group {
            if let entry = repositoryEntry, let problem = entry.unavailable {
                // GitHub no longer shows it: why stands in place of the list.
                unavailable(entry, problem: problem)
            } else {
                ForestList(
                    rows: rows,
                    style: RowStyle(listState: list?.state, showsRepository: scope == .all),
                    controller: controller,
                    labelFilter: list?.labelFilter ?? []
                ) {
                    if let list { notices(list, rows: rows) }
                } footer: {
                    if let list, !rows.isEmpty { ListFooter(text: ListWording.status(list)) }
                }
                .overlay {
                    if rows.isEmpty { placeholder(list) }
                }
                .refreshable {
                    await controller.refresh { model.list(for: scope)?.loading.state.isBusy ?? false }
                }
                .safeAreaBar(edge: .top) {
                    // Pinned under the title, as it says what the list shows;
                    // in the navigation bar's middle, it would push the
                    // counts below the title twice.
                    Picker("Issues Shown", selection: stateBinding(list)) {
                        Text("Open").tag(IssueState.open)
                        Text("Closed").tag(IssueState.closed)
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 420)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
                }
            }
        }
        .navigationTitle(scope.title)
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
        .onChange(of: list?.state) { _, state in
            if state == requestedState { requestedState = nil }
        }
        .sensoryFeedback(.selection, trigger: requestedState) { _, requested in requested != nil }
        .confirmationDialog(
            "Remove \(scope.title)?", isPresented: $confirmsRemoval, titleVisibility: .visible
        ) {
            Button("Remove Repository", role: .destructive) { removeRepository() }
        } message: {
            Text("Its issues no longer show in Verdandi. Views that search it stay as they are.")
        }
    }

    // MARK: - Title and toolbar

    private func subtitle(_ list: IssueList?) -> String {
        guard let list else { return "Loading…" }
        let parts = [ListWording.counts(list), ListWording.freshness(list.loading.state, now: now) ?? ""]
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    @ToolbarContentBuilder
    private func toolbar(_ list: IssueList?) -> some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Menu {
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
                    if let url = scope.issuesURL {
                        Button("Open on GitHub", systemImage: "safari") { openURL(url) }
                    }
                }
            } label: {
                Label("More", systemImage: "ellipsis")
            }
        }
    }

    /// Open or closed, as the user asked, until the core pushes the list
    /// in that state.
    private func stateBinding(_ list: IssueList?) -> Binding<IssueState> {
        Binding {
            requestedState ?? list?.state ?? .open
        } set: { state in
            guard state != (requestedState ?? list?.state) else { return }
            requestedState = state
            guard let core = model.core else { return }
            let scope = scope
            Task { await model.attempt { try await core.switchState(scope, to: state) } }
        }
    }

    // MARK: - Notices

    @ViewBuilder
    private func notices(_ list: IssueList, rows: [ListRow]) -> some View {
        if list.archived == true {
            ListNotice(
                tone: .info, systemImage: "archivebox", text: "This repository is archived",
                detail: "It is read-only on GitHub: its issues no longer change.")
        }
        switch list.loading.state {
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
                systemImage: "exclamationmark.triangle",
                text: "Not every \(list.state.rawValue) issue could be loaded",
                detail: ProblemText(problem, login: model.setup.account?.login).sentence
            ) {
                Button("Retry") { controller.retry() }
            }
        case .loading where !rows.isEmpty && list.state == .closed:
            ClosedProgress(progress: list.loading.progress)
        default:
            EmptyView()
        }
        ForEach(failedRepositories(list), id: \.repository) { part in
            if case .failed(let problem) = part.loading {
                ListNotice(
                    systemImage: "exclamationmark.triangle",
                    text: "\(part.repository.nameWithOwner) could not be loaded",
                    detail: ProblemText(problem, login: model.setup.account?.login).sentence
                ) {
                    Button("Retry") { controller.retry() }
                    if let url = Scope.repository(part.repository).issuesURL {
                        Button("Open on GitHub") { openURL(url) }
                    }
                }
            }
        }
        let unavailable = unavailableRepositories
        if scope == .all, !unavailable.isEmpty {
            ListNotice(
                tone: .info, systemImage: "eye.slash",
                text: "Unavailable: \(unavailable.map(\.repository.address.nameWithOwner).formatted(.list(type: .and)))",
                detail: "Their issues are not in All."
            ) {
                ForEach(unavailable.prefix(2), id: \.repository) { entry in
                    Button("Show \(entry.repository.name)") { model.select(.repository(entry.repository.address)) }
                }
            }
        }
        let missing = ListWording.missing(trees: list.trees, named: list.trees.compactMap { $0.parent?.unread })
        if !missing.isEmpty {
            ListNotice(systemImage: "exclamationmark.triangle", text: missing.joined(separator: " · ")) {
                Button("Retry") { controller.retry() }
            }
        }
    }

    /// The repositories within All that could not be read, but for those
    /// GitHub will not show, which the sidebar names as unavailable.
    private func failedRepositories(_ list: IssueList) -> [RepositoryLoading] {
        list.repositories.filter { part in
            guard case .failed(let problem) = part.loading else { return false }
            if case .unavailable = problem { return false }
            return true
        }
    }

    private var sidebarEntries: SidebarEntries.Read? {
        if case .read(let entries) = model.sidebar { return entries }
        return nil
    }

    /// The tracked repositories GitHub will not show, in the sidebar's order.
    private var unavailableRepositories: [RepositoryEntry] {
        sidebarEntries?.repositories.filter { $0.unavailable != nil } ?? []
    }

    /// The sidebar's entry of the repository, for a repository's list.
    private var repositoryEntry: RepositoryEntry? {
        guard case .repository(let address) = scope else { return nil }
        return sidebarEntries?.repositories.first { $0.repository.address.sameRepository(as: address) }
    }

    // MARK: - In place of the issues

    @ViewBuilder
    private func placeholder(_ list: IssueList?) -> some View {
        if let list {
            switch list.loading.state {
            case .loading:
                ListLoadingView(
                    title: list.state == .open ? "Loading Issues" : "Loading Closed Issues",
                    progress: list.loading.progress)
            case .failed(let problem):
                ListProblem(
                    title: "Could Not Load Issues", problem: problem, login: model.setup.account?.login,
                    url: scope.issuesURL, retry: controller.retry)
            default:
                if scope == .all, sidebarEntries?.repositories.isEmpty == true {
                    ContentUnavailableView {
                        Label("No Tracked Repositories", systemImage: "book.closed")
                    } description: {
                        Text("Add repositories to see their issues here, all in one list.")
                    } actions: {
                        Button("Add Repositories…") { model.sheet = .repositoryPicker }
                            .buttonStyle(.glassProminent)
                    }
                } else if !list.labelFilter.isEmpty {
                    NoLabelMatches(text: ListWording.status(list), clear: controller.clearFilter)
                } else {
                    noIssues(list.state)
                }
            }
        } else {
            ListLoadingView(title: "Loading Issues", progress: nil)
        }
    }

    private func noIssues(_ state: IssueState) -> some View {
        let other: IssueState = state == .open ? .closed : .open
        return ContentUnavailableView {
            Label(
                "No \(state == .open ? "Open" : "Closed") Issues",
                systemImage: state == .open ? "checkmark.circle" : "tray")
        } description: {
            switch scope {
            case .all: Text("None of the tracked repositories has \(state.rawValue) issues.")
            case .repository(let repository): Text("\(repository.nameWithOwner) has no \(state.rawValue) issues.")
            }
        } actions: {
            Button("Show \(other == .open ? "Open" : "Closed") Issues") { stateBinding(nil).wrappedValue = other }
                .buttonStyle(.glass)
        }
    }

    private func unavailable(_ entry: RepositoryEntry, problem: Problem) -> some View {
        let address = entry.repository.address
        let nameTakenOver = if case .unavailable(_, _, true) = problem { true } else { false }
        return ListProblem(
            title: "Issues Unavailable", problem: problem, login: model.setup.account?.login, repository: address,
            // Its address would open the repository that took it over.
            url: nameTakenOver ? nil : scope.issuesURL, retry: controller.retry
        ) {
            if nameTakenOver {
                Button("Track the New \(address.nameWithOwner)") { trackNew(entry.repository) }
                    .buttonStyle(.glass)
            }
            if case .unavailable = problem {
                Button("Remove Repository…", role: .destructive) { confirmsRemoval = true }
                    .buttonStyle(.glass)
            }
        }
    }

    private func removeRepository() {
        guard let core = model.core, let entry = repositoryEntry else { return }
        Task {
            await model.attempt {
                let result = try await core.removeRepository(entry.repository)
                if !result.ok, let message = result.message {
                    model.post(message, systemImage: "exclamationmark.triangle")
                }
            }
        }
    }

    private func trackNew(_ repository: TrackedRepository) {
        guard let core = model.core else { return }
        Task { await model.attempt { _ = try await core.replaceRepository(repository) } }
    }
}

/// How far a closed list's first read has come, above the issues it has
/// read so far.
private struct ClosedProgress: View {
    @Environment(\.palette) private var palette
    var progress: ListLoading.ListProgress?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let progress, let total = progress.total, total > 0 {
                Text("Loading closed issues… \(progress.read.formatted()) of \(total.formatted())")
                ProgressView(value: Double(min(progress.read, total)), total: Double(total))
            } else {
                Text("Loading closed issues…")
                ProgressView().progressViewStyle(.linear)
            }
        }
        .font(.footnote.monospacedDigit())
        .foregroundStyle(palette.muted)
        .padding(.vertical, 6)
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
        .selectionDisabled()
    }
}

/// What a list shows in place of its issues when none has every label of
/// its label filter, with a button that clears it.
struct NoLabelMatches: View {
    var text: String
    var clear: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("No Matches", systemImage: "line.3.horizontal.decrease.circle")
        } description: {
            Text(text)
        } actions: {
            Button("Clear Label Filter", action: clear)
                .buttonStyle(.glass)
        }
    }
}

extension Scope {
    var title: String {
        switch self {
        case .all: "All"
        case .repository(let repository): repository.name
        }
    }

    /// The repository's issues on github.com; none for All.
    var issuesURL: URL? {
        guard case .repository(let repository) = self else { return nil }
        return URL(string: "https://github.com/\(repository.nameWithOwner)/issues")
    }

    /// The same scope, whatever the case of its repository's address.
    func same(as other: Scope) -> Bool {
        switch (self, other) {
        case (.all, .all): true
        case (.repository(let a), .repository(let b)): a.sameRepository(as: b)
        default: false
        }
    }
}

extension AppModel {
    /// The list of a scope as the core pushed it last, also when the core
    /// spells its repository's address in another case.
    func list(for scope: Scope) -> IssueList? {
        lists[scope] ?? lists.first { $0.key.same(as: scope) }?.value
    }
}
