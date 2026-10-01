import SwiftUI
import VerdandiCore

/// The detail column: the selected issue's page.
struct DetailColumn: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    if let issueID = model.selectedIssueID {
      IssuePageView(issueID: issueID)
        .id(issueID)
    } else {
      ContentUnavailableView(
        "No Issue Selected", systemImage: "circle.dashed",
        description: Text("Choose an issue from the list."))
    }
  }
}
