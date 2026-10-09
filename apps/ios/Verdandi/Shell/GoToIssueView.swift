import SwiftUI
import VerdandiKit

/// Go to Issue (⌘K): a field that takes `#12` or `12` in the repository on
/// screen, `owner/name#12`, `owner/name 12` or a link to an issue on
/// GitHub, and below it the issue typed, then the recent issues matching
/// what is typed. A recent issue opens at once; any other is looked up on
/// GitHub first, and the sheet says why one cannot open. A pull request's
/// number offers to open it on GitHub instead, as Verdandi shows only
/// issues. Return goes to the first.
struct GoToIssueView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.palette) private var palette

    @State private var text = ""
    @State private var status = Status.idle
    @State private var lookup: Task<Void, Never>?
    @FocusState private var focused: Bool
    /// Whether a launch has typed into it already.
    private static var launchTextUsed = false

    /// What the sheet says of the issue typed, under the field.
    enum Status: Equatable {
        case idle
        case lookingUp(String)
        case failed(Problem)
        /// `owner/name#12` is a pull request, at its link.
        case pullRequest(String, URL?)
    }

    var body: some View {
        let choices = GoToChoices(text, from: from, recents: model.recentIssues)
        NavigationStack {
            List {
                statusSection(hint: choices.hint)
                let typed = choices.destinations.first.flatMap { destination -> GoToDestination? in
                    if case .lookUp = destination { return destination }
                    return nil
                }
                if let typed {
                    Section {
                        row(typed)
                    }
                }
                let recents = choices.destinations.filter { $0 != typed }
                if !recents.isEmpty {
                    Section("Recent") {
                        ForEach(recents, id: \.self, content: row)
                    }
                } else if model.recentIssues.isEmpty, text.trimmingCharacters(in: .whitespaces).isEmpty {
                    Section {
                        ContentUnavailableView(
                            "No Recent Issues", systemImage: "clock.arrow.circlepath",
                            description: Text("The issues you open appear here."))
                    }
                    .listRowBackground(Color.clear)
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $text, placement: .navigationBarDrawer(displayMode: .always), prompt: prompt)
            .searchFocused($focused)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .onSubmit(of: .search) { go(to: choices.destinations.first) }
            .navigationTitle("Go to Issue")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }
                }
            }
            .animation(.snappy(duration: 0.2), value: choices)
            .animation(.snappy(duration: 0.2), value: status)
        }
        .onChange(of: text) {
            // Only what is typed now is looked up.
            lookup?.cancel()
            lookup = nil
            status = .idle
        }
        .onDisappear { lookup?.cancel() }
        .task {
            focused = true
            if let core = model.core, let recents = try? await core.getRecentIssues() {
                model.recentIssues = recents
            }
            useLaunchText()
        }
    }

    // MARK: Parts

    private var prompt: String {
        if let from { return "#12 in \(from.name), owner/name#12 or a link" }
        return "owner/name#12 or a link to an issue"
    }

    @ViewBuilder private func statusSection(hint: String?) -> some View {
        switch status {
        case .idle, .lookingUp:
            if let hint {
                Section {
                    Label(hint, systemImage: "info.circle")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        case .failed(let problem):
            Section {
                ProblemRow(problem: problem, login: model.setup.account?.login)
            }
        case .pullRequest(let reference, let url):
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Label {
                        Text("\(reference) is a pull request, which Verdandi does not show.")
                    } icon: {
                        Image(systemName: "arrow.triangle.pull").foregroundStyle(palette.accent)
                    }
                    if let url {
                        Button("Open on GitHub", systemImage: "arrow.up.forward.square") {
                            openURL(url)
                            dismiss()
                        }
                        .buttonStyle(.glass)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }

    private func row(_ destination: GoToDestination) -> some View {
        Button {
            go(to: destination)
        } label: {
            switch destination {
            case .lookUp(let repository, let number):
                HStack(spacing: 12) {
                    Image(systemName: "arrow.right.circle.fill")
                        .font(.title3)
                        .foregroundStyle(palette.accent)
                        .accessibilityHidden(true)
                    Text("Go to \(Text(verbatim: "\(repository.nameWithOwner)#\(number)").fontWeight(.semibold))")
                    Spacer(minLength: 8)
                    if status == .lookingUp(destination.reference) {
                        ProgressView()
                            .accessibilityLabel("Looking up \(destination.reference)")
                    }
                }
            case .recent(let issue):
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Image(systemName: "clock.arrow.circlepath")
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        // The button's tint is for the issue typed, above.
                        Text(issue.title)
                            .foregroundStyle(Color.primary)
                            .lineLimit(2)
                        Text(verbatim: "\(issue.repository.nameWithOwner) #\(issue.number)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
            }
        }
        .disabled(isLookingUp)
    }

    // MARK: Going

    /// The repository a bare `#12` names: the selected one, or the shown
    /// issue's.
    private var from: RepositoryAddress? {
        if case .repository(let repository) = model.selection { return repository }
        guard let shown = model.issuePath.last ?? model.selectedIssue else { return nil }
        let located = shown.url.flatMap(IssueLocator.init(parsing:)) ?? IssueLocator(parsing: shown.reference)
        return located?.repository
    }

    private var isLookingUp: Bool {
        if case .lookingUp = status { return true }
        return false
    }

    private func go(to destination: GoToDestination?) {
        guard let destination, !isLookingUp else { return }
        switch destination {
        case .recent(let issue):
            open(issue)
        case .lookUp(let repository, let number):
            guard let core = model.core else { return }
            let reference = destination.reference
            status = .lookingUp(reference)
            lookup = Task {
                let found: IssueLookup
                do {
                    found = try await core.lookUpIssue(repository, number: number)
                } catch {
                    found = .failed(.error(message: error.localizedDescription))
                }
                guard !Task.isCancelled else { return }
                switch found {
                case .found(let issue):
                    status = .idle
                    // Its link names where it lives now, also once it has moved.
                    let located = IssueLocator(parsing: issue.url)
                    open(
                        RecentIssue(
                            id: issue.id, repository: located?.repository ?? repository,
                            number: located?.number ?? number, title: issue.title))
                case .pullRequest(let url):
                    status = .pullRequest(reference, URL(string: url))
                case .failed(.interrupted):
                    // Dropped, e.g. as GitHub is read as another account:
                    // Return asks again.
                    status = .idle
                case .failed(let problem):
                    status = .failed(problem)
                }
            }
        }
    }

    /// Opens an issue over the list on screen, named as that list names it:
    /// `#12` in its own repository's, `owner/name#12` elsewhere.
    private func open(_ issue: RecentIssue) {
        var own = false
        if case .repository(let repository) = model.selection {
            own = repository.sameRepository(as: issue.repository)
        }
        let route = IssueRoute(
            id: issue.id, reference: own ? "#\(issue.number)" : issue.reference, title: issue.title, url: issue.url)
        model.openIssue(route)
        dismiss()
    }

    /// `VERDANDI_GO_TO`: the launch's text, typed in once, and gone to with
    /// `VERDANDI_GO_TO_SUBMIT`.
    private func useLaunchText() {
        guard let launchText = model.launch.goTo, !Self.launchTextUsed else { return }
        Self.launchTextUsed = true
        text = launchText
        guard model.launch.goToSubmits else { return }
        Task {
            // After the change to the text has cleared the status.
            try? await Task.sleep(for: .milliseconds(300))
            go(to: GoToChoices(launchText, from: from, recents: model.recentIssues).destinations.first)
        }
    }
}

/// Why an issue could not be opened, as the desktop says it: what GitHub
/// will not show is unavailable or not accessible, with GitHub's own words
/// below, and a link only when GitHub gave one.
private struct ProblemRow: View {
    @Environment(\.openURL) private var openURL
    var problem: Problem
    var login: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label {
                VStack(alignment: .leading, spacing: 3) {
                    Text(text.headline)
                        .foregroundStyle(.primary)
                    if let detail = text.detail {
                        Text(detail)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: symbol).foregroundStyle(.orange)
            }
            if let link = text.link {
                Button("Authorize on GitHub", systemImage: "arrow.up.forward.square") { openURL(link) }
                    .buttonStyle(.glass)
            }
        }
        .padding(.vertical, 4)
    }

    private var symbol: String {
        switch problem {
        case .unreachable: "wifi.exclamationmark"
        case .unavailable: "eye.slash"
        default: "exclamationmark.triangle.fill"
        }
    }

    private var text: (headline: String, detail: String?, link: URL?) {
        switch problem {
        case .unreachable(let message):
            return ("Cannot reach GitHub", message, nil)
        case .unavailable(let access, let issuesDisabled, let nameTakenOver):
            if nameTakenOver {
                return ("Its name now names a different repository, and the one meant is unavailable or not accessible with this account.", nil, nil)
            }
            let account = login.map { " (@\($0))" } ?? ""
            var link: URL?
            if case .sso(_, let url?) = access { link = URL(string: url) }
            return (
                "Unavailable or not accessible with this account\(account)",
                issuesDisabled ? "Issues are turned off for this repository." : access?.message, link
            )
        case .interrupted:
            return ("Looking it up was interrupted.", nil, nil)
        case .error(let message):
            return (message, nil, nil)
        }
    }
}
