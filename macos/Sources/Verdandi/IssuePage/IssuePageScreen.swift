import AppKit
import SwiftUI
import VerdandiCore

/// An issue's page as it shows over the list, with what can be done with
/// the issue in the toolbar.
///
/// One keyboard cursor moves through the page, on the issue as it opens:
/// `j`/`k` and ↑/↓ through the parent issues, the issue and its
/// sub-issues, in the page's order. The issue is also the blocking map's
/// middle card: on the map, `h`/`j`/`k`/`l` and the arrows move between
/// cards by where they are, and up or down past a column's ends leave it.
/// Return opens the issue under the cursor over the page, `o` opens it on
/// GitHub, Space and ⇧Space scroll by a screen. Esc, ⌫ and [ go back, as
/// the toolbar's back button does.
struct IssuePageScreen: View {
  @Environment(AppModel.self) private var model
  var visit: IssueVisit
  @FocusState private var focused: Bool

  var body: some View {
    let page = model.pages.page(for: visit.issueID)
    let targets = model.pages.targets(of: page)
    let cursor = targets.shown(visit.cursor)
    IssuePageView(issueID: visit.issueID)
      .environment(visit)
      .environment(\.pageCursor, cursor)
      // The page takes the keyboard as it shows, so its keys work at once.
      .focusable()
      .focused($focused)
      .focusEffectDisabled()
      .onKeyPress(phases: [.down, .repeat]) { press in
        handle(press, page: page, targets: targets, cursor: cursor)
      }
      // ⌫ reaches a focused view as the Delete command, before any key
      // handler sees it.
      .onDeleteCommand { model.goBack() }
      .onAppear { focused = true }
      .navigationTitle(title)
      .toolbar { IssuePageToolbar(issueID: visit.issueID) }
  }

  private var title: String {
    let issue = model.issues[visit.issueID] ?? model.pages.page(for: visit.issueID).details?.issue
    return issue?.qualifiedReference ?? "Issue"
  }

  /// What a key does on the page.
  private func handle(
    _ press: KeyPress, page: IssuePageModel, targets: PageTargets, cursor: PageCursor
  ) -> KeyPress.Result {
    guard press.modifiers.isDisjoint(with: [.command, .control, .option]) else { return .ignored }
    switch press.key {
    case .escape, .delete, .deleteForward, "[":
      guard press.phase == .down else { return .handled }
      model.goBack()
      return .handled
    case .space:
      scrollByScreen(press.modifiers.contains(.shift) ? -1 : 1)
      return .handled
    default:
      break
    }
    guard !press.modifiers.contains(.shift) else { return .ignored }
    if let direction = direction(of: press) {
      if let next = targets.move(cursor, toward: direction) { visit.cursor = next }
      return .handled
    }
    if press.key == .return {
      if press.phase == .down { model.pages.open(cursor, in: visit) }
      return .handled
    }
    if press.characters == "o" {
      if press.phase == .down, let id = cursor.issueID(root: visit.issueID),
        let url = model.pages.webURL(of: id, on: page)
      {
        NSWorkspace.shared.open(url)
      }
      return .handled
    }
    return .ignored
  }

  private func direction(of press: KeyPress) -> MapDirection? {
    switch press.key {
    case .leftArrow: return .left
    case .rightArrow: return .right
    case .upArrow: return .up
    case .downArrow: return .down
    default: break
    }
    switch press.characters {
    case "h": return .left
    case "l": return .right
    case "k": return .up
    case "j": return .down
    default: return nil
    }
  }

  /// Scrolls the page a screen down, or up, keeping a little of what
  /// showed in sight.
  private func scrollByScreen(_ direction: CGFloat) {
    guard let geometry = visit.scrollGeometry else { return }
    // `scrollTo(y:)` counts from the content's top, below the toolbar the
    // page scrolls under; the offset counts from the top of the window's
    // content.
    let insets = geometry.contentInsets
    let screen = geometry.visibleRect.height - insets.top - insets.bottom
    let y = geometry.contentOffset.y + insets.top + direction * screen * 0.85
    withAnimation(.smooth) {
      visit.scroll.scrollTo(y: min(max(0, geometry.contentSize.height - screen), max(0, y)))
    }
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
