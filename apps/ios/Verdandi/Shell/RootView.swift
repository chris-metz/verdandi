import SwiftUI
import VerdandiKit

/// The window: the sidebar, a sidebar entry's list, and the issue page, in
/// three columns on an iPad and one after another on an iPhone. Until
/// GitHub can be read, signing in covers it.
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var systemScheme
    @State private var columns = NavigationSplitViewVisibility.all
    /// Why signing in is needed, kept while GitHub checks a token, so that
    /// signing in holds still until GitHub has answered.
    @State private var signInProblem: SetupProblem?

    var body: some View {
        @Bindable var model = model
        content
            .environment(\.palette, palette)
            .preferredColorScheme(preferredScheme)
            .tint(palette.accent)
            .sheet(item: $model.sheet) { sheet in
                Group {
                    switch sheet {
                    case .repositoryPicker: RepositoryPickerView()
                    case .newView: ViewEditorView(editing: model.editedView)
                    case .settings: SettingsView()
                    case .goToIssue: GoToIssueView()
                    }
                }
                .environment(model)
                .environment(\.palette, palette)
                .tint(palette.accent)
            }
            .overlay(alignment: .bottom) { NoticesOverlay() }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .starting:
            StartingView(message: "Starting…")
        case .failed(let message):
            StartFailedView(message: message)
        case .running:
            Group {
                if case .ready = model.setup {
                    split
                } else if let problem = shownSignInProblem {
                    SignInView(problem: problem)
                } else {
                    StartingView(message: "Checking your GitHub sign-in…")
                }
            }
            .onChange(of: model.setup, initial: true) { _, setup in
                switch setup {
                case .blocked(let problem): signInProblem = problem
                case .ready: signInProblem = nil
                case .checking: break
                }
            }
        }
    }

    /// The problem signing in shows: the setup's, or, while it is checked
    /// again, the one before.
    private var shownSignInProblem: SetupProblem? {
        if case .blocked(let problem) = model.setup { return problem }
        return signInProblem
    }

    private var split: some View {
        @Bindable var model = model
        return NavigationSplitView(columnVisibility: $columns) {
            SidebarView()
                .navigationSplitViewColumnWidth(min: 240, ideal: 280, max: 360)
        } content: {
            ListColumn()
                .navigationSplitViewColumnWidth(min: 320, ideal: 400, max: 560)
        } detail: {
            IssueDetailColumn()
        }
        .navigationSplitViewStyle(.balanced)
        .onChange(of: model.selectedIssue) { previous, issue in
            // Back from an issue on an iPhone: the list is on screen again.
            if issue == nil, previous != nil { model.openShown() }
        }
        .onChange(of: model.issuePath) { previous, path in
            if path.count < previous.count { model.openShown() }
        }
    }

    /// The theme shown: the user's light or dark one, as the appearance says.
    private var palette: Palette {
        let dark = (preferredScheme ?? systemScheme) == .dark
        let config = model.config?.config
        let id = dark ? config?.darkTheme ?? "github-dark" : config?.lightTheme ?? "github-light"
        let theme =
            model.themes.first { $0.id == id && $0.kind == (dark ? .dark : .light) }
            ?? model.themes.first { $0.id == (dark ? "github-dark" : "github-light") }
        return Palette(theme: theme)
    }

    private var preferredScheme: ColorScheme? {
        switch model.launch.appearance ?? model.config?.config.appearance ?? .system {
        case .light: .light
        case .dark: .dark
        case .system: nil
        }
    }
}

/// The middle column: the list of the selected sidebar entry.
struct ListColumn: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        list
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Go to Issue", systemImage: "number") { model.sheet = .goToIssue }
                }
            }
    }

    @ViewBuilder private var list: some View {
        switch model.selection {
        case .all: IssueListScreen(scope: .all)
        case .repository(let repository): IssueListScreen(scope: .repository(repository)).id(repository)
        case .view(let id): ViewScreen(viewId: id).id(id)
        case nil:
            ContentUnavailableView("Choose a list", systemImage: "sidebar.left", description: Text("Choose All, a repository or a view."))
        }
    }
}

/// The right column: the issue chosen in the list, and the issues opened
/// from its page, one after another.
struct IssueDetailColumn: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.issuePath) {
            Group {
                if let issue = model.selectedIssue {
                    IssuePageScreen(route: issue).id(issue.id)
                } else {
                    ContentUnavailableView(
                        "No issue chosen", systemImage: "circle.dashed",
                        description: Text("Choose an issue to see how it relates to others."))
                }
            }
            .navigationDestination(for: IssueRoute.self) { route in
                IssuePageScreen(route: route).id(route.id)
            }
        }
    }
}
