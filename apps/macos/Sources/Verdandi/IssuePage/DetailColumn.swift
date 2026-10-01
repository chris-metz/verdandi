import AppKit
import SwiftUI
import VerdandiCore

/// The detail column: the selected issue's page, with Back and Forward
/// through the issues it showed, and what can be done with the issue.
struct DetailColumn: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    Group {
      if let issueID = model.selectedIssueID {
        IssuePageView(issueID: issueID)
          .id(issueID)
          .transition(.opacity)
      } else {
        ContentUnavailableView(
          "No Issue Selected", systemImage: "circle.dashed",
          description: Text("Choose an issue from the list."))
      }
    }
    .animation(.smooth(duration: 0.2), value: model.selectedIssueID)
    .onChange(of: model.selectedIssueID, initial: true) { _, issueID in
      model.pages.didShow(issueID)
    }
    .toolbar { IssuePageToolbar() }
  }
}

/// Back and Forward, Refresh, Open on GitHub and Share.
private struct IssuePageToolbar: ToolbarContent {
  @Environment(AppModel.self) private var model

  var body: some ToolbarContent {
    let pages = model.pages
    ToolbarItemGroup(placement: .primaryAction) {
      Button("Back", systemImage: "chevron.backward") { pages.goBack() }
        .disabled(!pages.canGoBack)
        .keyboardShortcut("[", modifiers: .command)
        .help("Show the issue shown before")
      Button("Forward", systemImage: "chevron.forward") { pages.goForward() }
        .disabled(!pages.canGoForward)
        .keyboardShortcut("]", modifiers: .command)
        .help("Show the issue shown after")
    }
    if let issueID = model.selectedIssueID {
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
  }

  private func copy(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
  }
}
