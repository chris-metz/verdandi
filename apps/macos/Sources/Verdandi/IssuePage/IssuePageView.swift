import SwiftUI
import VerdandiCore

/// An issue's page: title, metadata and body.
struct IssuePageView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.openURL) private var openURL
  var issueID: String

  var body: some View {
    let page = model.pages.page(for: issueID)
    let issue = page.details?.issue ?? model.issues[issueID]
    ScrollView {
      if let issue {
        VStack(alignment: .leading, spacing: 12) {
          Text(issue.qualifiedReference).font(.callout).foregroundStyle(.secondary)
          Text(issue.title).font(.largeTitle.bold()).textSelection(.enabled)
          HStack {
            IssueStateIcon(state: issue.state, reason: page.details?.stateReason)
            Text(issue.state == .open ? "Open" : "Closed")
            ForEach(issue.labels) { LabelChip(label: $0) }
          }
          if let details = page.details {
            Text(details.bodyHTML).font(.body.monospaced()).foregroundStyle(.secondary)
          }
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .overlay {
      if issue == nil, page.phase == .loading { ProgressView() }
    }
    .task { await model.pages.open(issueID) }
    .toolbar {
      if let issue {
        ToolbarItem {
          Button("Open on GitHub", systemImage: "safari") { openURL(issue.url) }
        }
      }
    }
  }
}
