import SwiftUI
import VerdandiKit

/// The blocking map: the issues that block this one, on the left, and
/// those it blocks, on the right, step by step. (A placeholder, to be
/// built: it lists the cards.)
struct BlockingMapView: View {
    @Environment(AppModel.self) private var model
    var map: BlockingMap
    /// The issue whose page shows the map.
    var issueId: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(map.cards.sorted { $0.step < $1.step }) { card in
                Button {
                    model.openIssue(IssueRoute(card.issue), fromPage: true)
                } label: {
                    HStack {
                        Text(card.step < 0 ? "Blocked by" : card.step > 0 ? "Blocks" : "This issue")
                            .font(.caption)
                            .frame(width: 80, alignment: .leading)
                        IssueRowContent(issue: card.issue)
                    }
                }
                .buttonStyle(.plain)
                .disabled(card.issue.id == issueId)
            }
        }
    }
}
