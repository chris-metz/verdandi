import SwiftUI
import VerdandiKit

/// A scope's list: its issues as a forest of sub-issues.
struct IssueListScreen: View {
    @Environment(AppModel.self) private var model
    let scope: Scope

    var body: some View {
        let list = model.lists[scope]
        List(selection: Binding(get: { model.selectedIssue }, set: { route in
            if let route { model.openIssue(route) } else { model.selectedIssue = nil }
        })) {
            ForEach(Self.rows(list?.trees ?? [])) { row in
                IssueRowContent(issue: row.node.issue, showsRepository: scope == .all, unread: row.node.unread)
                    .padding(.leading, CGFloat(row.depth) * 16)
                .tag(IssueRoute(row.node.issue))
            }
        }
        .overlay {
            if list == nil || list?.loading.state == .loading { ProgressView() }
        }
        .refreshable { await model.refresh() }
        .navigationTitle(scope.title)
    }

    struct Row: Identifiable {
        var node: IssueNode
        var depth: Int
        var id: String { node.id }
    }

    /// The forest, flattened as it shows: each issue under its parent.
    static func rows(_ trees: [IssueNode], depth: Int = 0) -> [Row] {
        trees.flatMap { node in
            [Row(node: node, depth: depth)] + (node.expanded ? rows(node.subIssues, depth: depth + 1) : [])
        }
    }
}

extension Scope {
    var title: String {
        switch self {
        case .all: "All"
        case .repository(let repository): repository.name
        }
    }
}
