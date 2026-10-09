import Foundation
import VerdandiKit

/// A row of a list as it shows, top to bottom: an issue at its depth in the
/// forest, without its sub-issues, which rows of their own show; or the
/// placeholder for a view's parent issue that could not be shown.
///
/// It holds only what the row draws, so that comparing two rows, as SwiftUI
/// does to know which to draw again, never walks a tree.
struct ListRow: Identifiable, Equatable {
    enum Kind: Equatable {
        case issue
        /// The parent issue above a view's tree that could not be loaded or
        /// is not visible; the tree nests below it.
        case missingParent(Problem)
    }

    var id: String
    var kind: Kind
    var issue: IssueInfo
    /// How deeply it is nested: 0 at the top level.
    var depth: Int
    var hasSubIssues: Bool
    var expanded: Bool
    var unread: UnreadIssue?
    var mark: MatchMark?
    /// The parent issue a top-level row names above it, which the list does
    /// not show.
    var parent: ParentIssue?
    /// In a view, the parent issue above a top-level row that still loads.
    var parentLoading = false
    /// The labels of the issue, once read, to filter by.
    var labels: [IssueLabel] { unread == nil ? issue.labels ?? [] : [] }
}

/// The rows a forest shows, flattened once each time the core pushes it or
/// the user expands or collapses an issue, rather than each time the screen
/// is drawn: a list of a large repository holds thousands of issues.
///
/// It also shows an expansion the user asked for at once, before the core
/// has pushed the list with it, so that a disclosure answers the tap, and
/// moves with an animation. What the core pushes wins once it agrees, or
/// once a few seconds have passed.
@MainActor
final class ForestRows {
    private var trees: [IssueNode]?
    private var expectedVersion = 0
    private var shownVersion = -1
    private(set) var rows: [ListRow] = []
    private var index: [String: Int] = [:]

    /// The expansions asked for that the core has not pushed yet.
    private var expected: [String: Expectation] = [:]
    /// Expand All or Collapse All, asked for and not yet pushed.
    private var everything: Expectation?

    private struct Expectation {
        var expanded: Bool
        var since: Date
    }

    /// How long an expansion asked for outlasts lists pushed without it.
    private static let patience: TimeInterval = 3

    /// The rows of `trees`, as last flattened if neither they nor the
    /// expected expansions changed. Two pushes of a list share no storage,
    /// so comparing their trees stops at the first difference; the same
    /// list compared to itself is equal at once.
    func rows(of trees: [IssueNode]) -> [ListRow] {
        let pushed = self.trees.map { $0 != trees } ?? true
        if !pushed, shownVersion == expectedVersion { return rows }
        if pushed { settleExpectations(in: trees) }
        self.trees = trees
        shownVersion = expectedVersion
        rows = flatten(trees)
        index = Dictionary(rows.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
        return rows
    }

    /// The row of an issue, if it shows.
    func row(_ id: String) -> ListRow? {
        index[id].flatMap { rows.indices.contains($0) ? rows[$0] : nil }
    }

    /// Shows an issue expanded or collapsed until the core says so too.
    func expect(_ id: String, expanded: Bool) {
        expected[id] = Expectation(expanded: expanded, since: .now)
        expectedVersion += 1
    }

    /// Shows every issue expanded or collapsed until the core says so too.
    func expectAll(expanded: Bool) {
        expected = [:]
        everything = Expectation(expanded: expanded, since: .now)
        expectedVersion += 1
    }

    /// Forgets what was asked for, e.g. when asking the core failed.
    func forgetExpectations() {
        expected = [:]
        everything = nil
        expectedVersion += 1
    }

    private func expansion(of node: IssueNode) -> Bool {
        guard !node.subIssues.isEmpty else { return false }
        return expected[node.id]?.expanded ?? everything?.expanded ?? node.expanded
    }

    /// Drops what the pushed trees agree with, or what they have kept
    /// disagreeing with for too long.
    private func settleExpectations(in trees: [IssueNode]) {
        guard !expected.isEmpty || everything != nil else { return }
        let now = Date.now
        var pushed: [String: Bool] = [:]
        var everythingAgrees = true
        func visit(_ node: IssueNode) {
            if !node.subIssues.isEmpty {
                if expected[node.id] != nil { pushed[node.id] = node.expanded }
                if let everything, node.expanded != everything.expanded { everythingAgrees = false }
            }
            node.subIssues.forEach(visit)
        }
        trees.forEach(visit)
        expected = expected.filter { id, expectation in
            guard let expanded = pushed[id] else { return false }
            return expanded != expectation.expanded && now.timeIntervalSince(expectation.since) < Self.patience
        }
        if let everything, everythingAgrees || now.timeIntervalSince(everything.since) >= Self.patience {
            self.everything = nil
        }
    }

    /// Every tree, with the sub-issues of expanded issues below them. A
    /// view's tree whose parent issue could not be shown nests below a
    /// placeholder for it, as on the desktop.
    private func flatten(_ trees: [IssueNode]) -> [ListRow] {
        var rows: [ListRow] = []
        rows.reserveCapacity(trees.count)
        func add(_ node: IssueNode, depth: Int, top: IssueNode?) {
            let expanded = expansion(of: node)
            rows.append(
                ListRow(
                    id: node.id, kind: .issue, issue: node.issue, depth: depth,
                    hasSubIssues: !node.subIssues.isEmpty, expanded: expanded, unread: node.unread,
                    mark: node.mark, parent: top?.parent,
                    parentLoading: top?.missingParent == .loading))
            guard expanded else { return }
            for subIssue in node.subIssues { add(subIssue, depth: depth + 1, top: nil) }
        }
        for tree in trees {
            if case .failed(let problem) = tree.missingParent {
                rows.append(
                    ListRow(
                        id: "missing-parent:\(tree.id)", kind: .missingParent(problem), issue: tree.issue, depth: 0,
                        hasSubIssues: false, expanded: false))
                add(tree, depth: 1, top: nil)
            } else {
                add(tree, depth: 0, top: tree)
            }
        }
        return rows
    }
}
