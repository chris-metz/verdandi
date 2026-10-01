import AppKit
import SwiftUI
import VerdandiCore

/// An issue's page as it shows over the list, with what can be done with
/// the issue in the toolbar. Esc, ⌫ and [ go back, as the toolbar's back
/// button does.
struct IssuePageScreen: View {
  @Environment(AppModel.self) private var model
  var issueID: String
  @FocusState private var focused: Bool

  var body: some View {
    IssuePageView(issueID: issueID)
      // The page takes the keyboard as it shows, so its keys work at once;
      // the map within it takes it on a click.
      .focusable()
      .focused($focused)
      .focusEffectDisabled()
      .onKeyPress(keys: [.escape, .delete, .deleteForward, "["], phases: .down) { press in
        guard press.modifiers.isDisjoint(with: [.command, .control, .option]) else { return .ignored }
        model.goBack()
        return .handled
      }
      // ⌫ reaches a focused view as the Delete command, before any key
      // handler sees it.
      .onDeleteCommand { model.goBack() }
      .onAppear { focused = true }
      .navigationTitle(title)
      .toolbar { IssuePageToolbar(issueID: issueID) }
  }

  private var title: String {
    let issue = model.issues[issueID] ?? model.pages.page(for: issueID).details?.issue
    return issue?.qualifiedReference ?? "Issue"
  }
}

/// Refresh, Open on GitHub and Share.
private struct IssuePageToolbar: ToolbarContent {
  @Environment(AppModel.self) private var model
  var issueID: String

  var body: some ToolbarContent {
    let pages = model.pages
    let page = pages.page(for: issueID)
    let issue = model.issues[issueID] ?? page.details?.issue
    ToolbarSpacer(.flexible)
    ToolbarItemGroup {
      Button {
        Task { await pages.refresh(issueID) }
      } label: {
        Label("Refresh Issue", systemImage: "arrow.clockwise")
          .symbolEffect(.rotate.byLayer, options: .repeat(.continuous), isActive: page.isLoading)
      }
      .help(page.isLoading ? "Reading the issue…" : "Read the issue again")
      if let issue {
        Button("Open on GitHub", systemImage: "safari") { NSWorkspace.shared.open(issue.url) }
          .keyboardShortcut("o", modifiers: [.command, .shift])
          .help("Open the issue on GitHub")
        Menu {
          Button("Copy Link", systemImage: "link") { copy(issue.url.absoluteString) }
          Button("Copy Reference", systemImage: "number") { copy(issue.qualifiedReference) }
          Divider()
          ShareLink(item: issue.url, subject: Text(issue.title)) {
            Label("Share…", systemImage: "square.and.arrow.up")
          }
        } label: {
          Label("Share", systemImage: "square.and.arrow.up")
        }
        .help("Copy or share a link to the issue")
      }
    }
  }

  private func copy(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
  }
}
