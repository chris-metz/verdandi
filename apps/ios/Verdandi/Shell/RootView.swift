import SwiftUI
import VerdandiKit

/// The window: the sidebar, a sidebar entry's list, and the issue page, in
/// three columns on an iPad and one after another on an iPhone. Until
/// GitHub can be read, signing in covers it.
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var systemScheme
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var columns = NavigationSplitViewVisibility.all

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
            .overlay(alignment: .top) { NoticesOverlay() }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .starting:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView("Verdandi could not start", systemImage: "exclamationmark.triangle", description: Text(message))
        case .running:
            switch model.setup {
            case .checking:
                ProgressView("Checking your GitHub sign-in…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .blocked(let problem):
                SignInView(problem: problem)
            case .ready:
                split
            }
        }
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
        .onChange(of: sizeClass, initial: true) { _, sizeClass in
            // In columns, the list stays in sight beside the issue page.
            model.listBesideIssue = sizeClass == .regular
        }
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

/// Notices, briefly, over the top of the window.
struct NoticesOverlay: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        GlassEffectContainer(spacing: 8) {
            VStack(spacing: 8) {
                ForEach(model.notices) { notice in
                    Label(notice.text, systemImage: notice.systemImage)
                        .font(.callout)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .glassEffect(.regular, in: .capsule)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
        }
        .padding(.top, 8)
        .padding(.horizontal)
    }
}
