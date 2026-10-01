import SwiftUI
import VerdandiCore

/// The area beside the sidebar: the selected entry's list, and over it the
/// issue pages opened from it, one at a time. Esc, ⌫ or [ on a page goes
/// back to the page before it, or to the list.
struct MainArea: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    @Bindable var model = model
    NavigationStack(path: $model.issuePath) {
      ListColumn()
        .navigationDestination(for: String.self) { issueID in
          IssuePageScreen(issueID: issueID)
        }
    }
  }
}
