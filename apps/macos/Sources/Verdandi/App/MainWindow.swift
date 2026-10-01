import SwiftUI
import VerdandiCore

/// The window: the setup screen until gh works, then the sidebar beside
/// the list, with the issue pages opened over the list, and notices over
/// both.
struct MainWindow: View {
  @Environment(AppModel.self) private var model
  @Environment(\.openSettings) private var openSettings
  @Environment(\.openWindow) private var openWindow
  /// Whether gh has worked since launch: checking it again then keeps the
  /// browser on screen rather than the setup screen.
  @State private var hasBeenReady = false

  var body: some View {
    Group {
      if showsBrowser {
        BrowserView()
      } else {
        SetupView()
      }
    }
    .animation(.smooth(duration: 0.4), value: showsBrowser)
    .overlay(alignment: .bottom) { NoticesView() }
    .background(WindowNumberReporter())
    .onChange(of: model.setup) {
      if case .ready = model.setup { hasBeenReady = true }
    }
    .task {
      if LaunchOptions.settingsTab != nil { openSettings() }
      if LaunchOptions.opensAbout { openWindow(id: AboutView.windowID) }
      await LaunchOptions.start(model)
    }
    .task { await LaunchOptions.exerciseMenus() }
  }

  private var showsBrowser: Bool {
    switch model.setup {
    case .ready: true
    case .checking: hasBeenReady
    default: false
    }
  }
}

/// The sidebar beside the main area, with Go to Issue over them.
struct BrowserView: View {
  @Environment(AppModel.self) private var model
  @State private var columns = NavigationSplitViewVisibility.all

  var body: some View {
    @Bindable var model = model
    NavigationSplitView(columnVisibility: $columns) {
      SidebarView()
        .navigationSplitViewColumnWidth(min: 200, ideal: 230, max: 320)
    } detail: {
      MainArea()
    }
    .sheet(item: sheet) { sheet in
      switch sheet {
      case .repositoryPicker: RepositoryPickerView()
      case .viewEditor(let view, let duplicate): ViewEditorView(view: view, duplicate: duplicate)
      // Go to Issue floats over the window instead.
      case .goToIssue: EmptyView()
      }
    }
    .overlay { GoToIssueOverlay() }
    .background {
      // ⌘L goes to an issue too, as ⌘K in the Go menu does.
      Button("Go to Issue") { model.sheet = .goToIssue }
        .keyboardShortcut("l")
        .disabled(model.login == nil)
        .opacity(0)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
  }

  /// The sheet over the window, but for Go to Issue, which is no sheet.
  private var sheet: Binding<AppSheet?> {
    Binding(
      get: { model.sheet == .goToIssue ? nil : model.sheet },
      set: { model.sheet = $0 })
  }
}
