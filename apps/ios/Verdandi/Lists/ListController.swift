import SwiftUI
import UIKit
import VerdandiKit

/// What a list's rows and screen ask of the core: one per list on screen, a
/// scope's or a view's, which every row shares, so that rows hold no
/// closures and draw again only when what they show changes.
@MainActor @Observable
final class ListController {
    let list: ExpandableList
    @ObservationIgnored let forest = ForestRows()
    /// The model, which the screen hands over as it draws.
    @ObservationIgnored weak var model: AppModel?

    /// Changes as the user expands or collapses, so that the screen draws
    /// the rows again at once, with an animation.
    private(set) var expansions = 0
    /// Changes as a link is copied, for a tap of feedback.
    private(set) var copies = 0

    init(list: ExpandableList) {
        self.list = list
    }

    /// The screen the list is, to read again.
    var screen: Screen {
        switch list {
        case .scope(let scope): .list(scope)
        case .view(let id): .view(id: id)
        }
    }

    /// The rows the trees show, with the expansions asked for.
    func rows(of trees: [IssueNode]) -> [ListRow] {
        _ = expansions
        return forest.rows(of: trees)
    }

    // MARK: - Expanding

    func setExpanded(_ row: ListRow, _ expanded: Bool) {
        guard row.hasSubIssues else { return }
        withAnimation(.snappy(duration: 0.3)) {
            forest.expect(row.id, expanded: expanded)
            expansions += 1
        }
        ask { core in try await core.setExpanded(self.list, issueId: row.id, expanded: expanded) }
    }

    func setAllExpanded(_ expanded: Bool) {
        withAnimation(.snappy(duration: 0.3)) {
            forest.expectAll(expanded: expanded)
            expansions += 1
        }
        ask { core in try await core.setAllExpanded(self.list, expanded: expanded) }
    }

    // MARK: - Label filter

    func filter(by label: IssueLabel) {
        ask { core in try await core.addLabelToFilter(self.list, label) }
    }

    func removeFromFilter(_ name: String) {
        ask { core in try await core.removeLabelFromFilter(self.list, name: name) }
    }

    func clearFilter() {
        ask { core in try await core.clearLabelFilter(self.list) }
    }

    // MARK: - Sort order

    /// Orders a scope's list by a sort order; a view's search text orders it.
    func sort(by order: ListSortOrder) {
        guard case .scope(let scope) = list else { return }
        ask { core in try await core.setSortOrder(scope, to: order) }
    }

    // MARK: - Reading again

    /// Reads the list again now, and waits until it has been read, for pull
    /// to refresh to show as long as it takes. It asks for this list, not
    /// for whatever `AppModel.shownScreen` names: on an iPad the list shows
    /// beside an issue page, and is what the user pulled.
    func refresh(busy: () -> Bool) async {
        await model?.refresh(screen)
        await settle(busy: busy)
    }

    /// Reads again what failed in the list. Through the model, which keeps
    /// track of the screen the core shows.
    func retry() {
        let screen = screen
        Task { await model?.retry(screen) }
    }

    /// Waits until the list is no longer read, at most half a minute, and
    /// at least a moment, as the core pushes that it reads only after it
    /// was asked to.
    private func settle(busy: () -> Bool) async {
        let start = Date.now
        while Date.now.timeIntervalSince(start) < 30 {
            try? await Task.sleep(for: .milliseconds(150))
            if Task.isCancelled { return }
            if Date.now.timeIntervalSince(start) > 0.5, !busy() { return }
        }
    }

    // MARK: - Issues

    func open(_ route: IssueRoute) {
        model?.openIssue(route)
    }

    func copyLink(_ url: URL) {
        UIPasteboard.general.url = url
        copies += 1
    }

    /// Runs a request of the core, showing the expansions the core has
    /// again if it fails.
    private func ask(_ request: @escaping (Core) async throws -> Void) {
        guard let model, let core = model.core else { return }
        let list = list
        Task {
            do {
                // The core reads what a list asks for only while it shows it.
                await model.showList(list)
                try await request(core)
            } catch {
                AppModel.log.error("A list request failed: \(error.localizedDescription, privacy: .public)")
                forest.forgetExpectations()
                expansions += 1
            }
        }
    }
}

extension IssueInfo {
    /// Its page on github.com.
    var webURL: URL? { URL(string: url) }
}
