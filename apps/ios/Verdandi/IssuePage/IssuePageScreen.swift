import SwiftUI
import VerdandiKit

/// An issue's page: where it sits, what blocks it and what it blocks, its
/// sub-issues, its body and its comments.
struct IssuePageScreen: View {
    @Environment(AppModel.self) private var model
    let route: IssueRoute

    var body: some View {
        let page = model.pages[route.id]
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(route.reference).font(.subheadline).foregroundStyle(.secondary)
                Text(page?.issue?.title ?? route.title).font(.title2.bold())
                if let map = page?.blockingMap {
                    Text("\(map.cards.count) issues in the blocking map")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .refreshable { await model.refresh() }
        .navigationTitle(route.reference)
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: page?.issue?.id) { _, _ in
            if let issue = page?.issue { model.recordRecent(issue) }
        }
    }
}
