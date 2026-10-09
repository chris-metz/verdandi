import SwiftUI
import VerdandiKit

/// A view's screen: the issues its search matches, under their ancestry.
struct ViewScreen: View {
    @Environment(AppModel.self) private var model
    let viewId: String

    var body: some View {
        let list = model.views[viewId]
        List(selection: Binding(get: { model.selectedIssue }, set: { route in
            if let route { model.openIssue(route) } else { model.selectedIssue = nil }
        })) {
            ForEach(IssueListScreen.rows(list?.trees ?? [])) { row in
                IssueRowContent(issue: row.node.issue, showsRepository: true, unread: row.node.unread)
                    .padding(.leading, CGFloat(row.depth) * 16)
                    .tag(IssueRoute(row.node.issue))
            }
        }
        .refreshable { await model.refresh() }
        .navigationTitle(list?.view.name ?? "View")
    }
}
