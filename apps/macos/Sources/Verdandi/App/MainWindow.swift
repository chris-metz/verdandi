import SwiftUI
import VerdandiCore

/// The window: the setup screen until gh works, then sidebar, list and
/// issue page side by side.
struct MainWindow: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    Group {
      switch model.setup {
      case .ready:
        BrowserView()
      default:
        SetupView()
      }
    }
    .task { await model.checkSetup() }
    .overlay(alignment: .bottom) { NoticesView() }
    .background(WindowNumberReporter())
  }
}

/// Sidebar, list and issue page.
struct BrowserView: View {
  @Environment(AppModel.self) private var model
  @State private var columns = NavigationSplitViewVisibility.all

  var body: some View {
    @Bindable var model = model
    NavigationSplitView(columnVisibility: $columns) {
      SidebarView()
        .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 320)
    } content: {
      ListColumn()
        .navigationSplitViewColumnWidth(min: 320, ideal: 420, max: 640)
    } detail: {
      DetailColumn()
    }
    .sheet(item: $model.sheet) { sheet in
      switch sheet {
      case .repositoryPicker: RepositoryPickerView()
      case .viewEditor(let view, let duplicate): ViewEditorView(view: view, duplicate: duplicate)
      case .goToIssue: GoToIssueView()
      }
    }
  }
}

/// The notices over the window, newest last, each dismissable.
struct NoticesView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    VStack(spacing: 8) {
      ForEach(model.notices) { notice in
        HStack(alignment: .firstTextBaseline, spacing: 10) {
          Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
          VStack(alignment: .leading, spacing: 2) {
            Text(notice.title).font(.headline)
            Text(notice.message).font(.callout).foregroundStyle(.secondary)
          }
          Spacer(minLength: 12)
          Button("Dismiss", systemImage: "xmark") {
            model.notices.removeAll { $0.id == notice.id }
          }
          .labelStyle(.iconOnly)
          .buttonStyle(.borderless)
        }
        .padding(14)
        .frame(maxWidth: 520)
        .glassEffect(.regular, in: .rect(cornerRadius: 18))
        .transition(.move(edge: .bottom).combined(with: .opacity))
      }
    }
    .padding(20)
    .animation(.smooth, value: model.notices)
  }
}
