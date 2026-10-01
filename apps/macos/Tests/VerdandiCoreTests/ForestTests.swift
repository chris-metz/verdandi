import Foundation
import Testing

@testable import VerdandiCore

// MARK: Fixtures

private let mine = RepositoryAddress(owner: "me", name: "app")
private let lib = RepositoryAddress(owner: "me", name: "lib")
private let other = RepositoryAddress(owner: "them", name: "kit")

/// Issues by a short name, for tests to say how they relate.
private struct Issues {
  var byName: [String: VerdandiCore.Issue] = [:]

  /// Adds an issue, opened `day` days after the epoch.
  mutating func add(
    _ name: String, in repository: RepositoryAddress = mine, number: Int, day: Double, state: IssueState = .open,
    closedDay: Double? = nil, labels: [String] = [], parent: String? = nil
  ) {
    var issue = VerdandiCore.Issue(
      id: name, repository: repository, number: number, title: name, state: state,
      url: URL(string: "https://github.com/\(repository)/issues/\(number)")!,
      author: nil, createdAt: Date(timeIntervalSince1970: day * 86400),
      closedAt: closedDay.map { Date(timeIntervalSince1970: $0 * 86400) },
      labels: labels.map { Label(name: $0, color: "ff0000") }, parent: nil, subIssues: [], hasParent: false,
      subIssuesTotal: 0, subIssuesCompleted: 0, blockedBy: 0, totalBlockedBy: 0, blocking: 0, totalBlocking: 0)
    if let parent, var above = byName[parent] {
      issue.parent = above.reference
      issue.hasParent = true
      above.subIssues.append(issue.reference)
      above.subIssuesTotal += 1
      byName[parent] = above
    }
    byName[name] = issue
  }

  subscript(name: String) -> VerdandiCore.Issue { byName[name]! }

  /// The issues, without those named, as when they have not been read.
  func without(_ names: String...) -> [String: VerdandiCore.Issue] {
    byName.filter { !names.contains($0.key) }
  }
}

/// The forest as nested names, e.g. `["a", "  b", "c"]`.
private func outline(_ forest: Forest) -> [String] {
  var lines: [String] = []
  func add(_ node: ForestNode, depth: Int) {
    lines.append(String(repeating: "  ", count: depth) + node.id)
    for subIssue in node.subIssues { add(subIssue, depth: depth + 1) }
  }
  for tree in forest.trees { add(tree, depth: 0) }
  return lines
}

// MARK: Lists

@Test func listsNewestFirstWithSubIssuesNested() {
  var issues = Issues()
  issues.add("old", number: 1, day: 1)
  issues.add("epic", number: 2, day: 2)
  issues.add("child", number: 3, day: 3, parent: "epic")
  issues.add("new", number: 4, day: 4)
  issues.add("grandchild", number: 5, day: 10, parent: "child")

  let forest = Forest.list(
    scope: .repository(mine), state: .open, scopeIDs: ["new", "grandchild", "child", "epic", "old"],
    issues: issues.byName, tracked: [mine])

  // The epic is as new as its newest match, the grandchild.
  #expect(outline(forest) == ["epic", "  child", "    grandchild", "new", "old"])
  #expect(forest.matchCount == 5)
  #expect(forest.missing.isEmpty)
  #expect(forest.trees.allSatisfy { $0.mark == nil })
}

@Test func climbsAncestorsThroughOtherRepositories() {
  var issues = Issues()
  issues.add("top", number: 1, day: 1)
  issues.add("between", in: other, number: 7, day: 2, parent: "top")
  issues.add("match", number: 2, day: 3, parent: "between")

  let forest = Forest.list(
    scope: .repository(mine), state: .open, scopeIDs: ["match"], issues: issues.byName, tracked: [mine])

  // The top issue is this repository's, though an external one lies between.
  #expect(outline(forest) == ["top", "  between", "    match"])
  #expect(forest.trees[0].subIssues[0].isExternal)
  #expect(forest.trees[0].parent == nil)
}

@Test func namesAParentElsewhereWithAChip() {
  var issues = Issues()
  issues.add("elsewhere", in: other, number: 9, day: 1)
  issues.add("match", number: 2, day: 2, parent: "elsewhere")

  let forest = Forest.list(
    scope: .repository(mine), state: .open, scopeIDs: ["match"], issues: issues.byName, tracked: [mine])

  #expect(outline(forest) == ["match"])
  let parent = try! #require(forest.trees[0].parent)
  #expect(parent.reference.id == "elsewhere")
  #expect(parent.isExternal)
  #expect(parent.unread == nil)
}

@Test func allListsEveryTrackedRepositoryTogether() {
  var issues = Issues()
  issues.add("epic", in: lib, number: 1, day: 1)
  issues.add("task", number: 5, day: 2, parent: "epic")

  let forest = Forest.list(
    scope: .all, state: .open, scopeIDs: ["task", "epic"], issues: issues.byName, tracked: [mine, lib])

  // The task nests below its parent in another tracked repository, once.
  #expect(outline(forest) == ["epic", "  task"])
  #expect(!forest.trees[0].isExternal)
}

@Test func showsUnreadSubIssuesAndNamesThemMissing() {
  var issues = Issues()
  issues.add("epic", number: 1, day: 1)
  issues.add("done", number: 2, day: 2, state: .closed, closedDay: 3, parent: "epic")
  issues.add("broken", in: other, number: 3, day: 2, parent: "epic")

  let forest = Forest.list(
    scope: .repository(mine), state: .open, scopeIDs: ["epic"], issues: issues.without("done", "broken"),
    failures: ["broken": .unavailable("Not yours.")], tracked: [mine])

  #expect(outline(forest) == ["epic", "  done", "  broken"])
  let subIssues = forest.trees[0].subIssues
  #expect(subIssues[0].unread == .loading)
  #expect(subIssues[0].issue == nil)
  #expect(subIssues[1].unread == .failed(.unavailable("Not yours.")))
  #expect(subIssues[1].isExternal)
  #expect(forest.missing.map(\.id) == ["done", "broken"])
  #expect(forest.missingShown == ["done", "broken"])
}

@Test func namesAnUnreadParentMissing() {
  var issues = Issues()
  issues.add("parent", number: 1, day: 1)
  issues.add("match", number: 2, day: 2, parent: "parent")

  let forest = Forest.list(
    scope: .repository(mine), state: .open, scopeIDs: ["match"], issues: issues.without("parent"),
    tracked: [mine])

  #expect(outline(forest) == ["match"])
  #expect(forest.trees[0].parent?.unread == .loading)
  #expect(forest.missing.map(\.id) == ["parent"])
}

@Test func keepsWhatCollapsedIssuesHideForLater() {
  var issues = Issues()
  issues.add("epic", number: 1, day: 1)
  issues.add("hidden", number: 2, day: 2, parent: "epic")

  var expansion = Expansion()
  expansion.set("epic", expanded: false)
  let forest = Forest.list(
    scope: .repository(mine), state: .open, scopeIDs: ["epic"], issues: issues.without("hidden"),
    tracked: [mine], expansion: expansion)

  #expect(!forest.trees[0].isExpanded)
  #expect(forest.belowCollapsed == ["hidden"])
  #expect(forest.missingShown.isEmpty)
  #expect(forest.visibleRows.map(\.id) == ["epic"])
}

@Test func marksMatchesAndContextIssuesWithALabelFilter() {
  var issues = Issues()
  issues.add("epic", number: 1, day: 1, labels: ["feature"])
  issues.add("bug", number: 2, day: 2, labels: ["Bug"], parent: "epic")
  issues.add("chore", number: 3, day: 3, parent: "epic")
  issues.add("lonely", number: 4, day: 4)

  let forest = Forest.list(
    scope: .repository(mine), state: .open, scopeIDs: ["lonely", "chore", "bug", "epic"],
    labelFilter: [Label(name: "bug", color: "000000")], issues: issues.byName, tracked: [mine])

  // Only the epic above the match lists; its other sub-issue is context.
  #expect(outline(forest) == ["epic", "  bug", "  chore"])
  #expect(forest.trees[0].mark == MatchMark(isMatch: false, matchesInside: 1))
  #expect(forest.trees[0].subIssues[0].mark?.isMatch == true)
  #expect(forest.trees[0].subIssues[1].mark?.isMatch == false)
  #expect(forest.matchCount == 1)
  #expect(forest.scopeCount == 4)
}

@Test func ordersAClosedListByWhenIssuesClosed() {
  var issues = Issues()
  issues.add("closedLate", number: 1, day: 1, state: .closed, closedDay: 30)
  issues.add("closedEarly", number: 2, day: 20, state: .closed, closedDay: 21)

  let forest = Forest.list(
    scope: .repository(mine), state: .closed, scopeIDs: ["closedEarly", "closedLate"], issues: issues.byName,
    tracked: [mine])

  #expect(outline(forest) == ["closedLate", "closedEarly"])
}

@Test func listsAnIssueOnceThoughSeveralPathsLeadToIt() {
  var issues = Issues()
  issues.add("epic", number: 1, day: 1)
  issues.add("task", number: 2, day: 2, parent: "epic")

  let forest = Forest.list(
    scope: .repository(mine), state: .open, scopeIDs: ["task", "epic", "task"], issues: issues.byName,
    tracked: [mine])

  #expect(outline(forest) == ["epic", "  task"])
  #expect(forest.scopeCount == 2)
}

@Test func expandsAndCollapsesEverythingAtOnce() {
  var expansion = Expansion()
  expansion.set("a", expanded: false)
  expansion.setEverything(expanded: false)
  #expect(!expansion.isExpanded("b", byDefault: true))
  expansion.set("b", expanded: true)
  #expect(expansion.isExpanded("b", byDefault: false))
  expansion.setEverything(expanded: true)
  #expect(expansion.isExpanded("b", byDefault: false))
  #expect(expansion.chosen.isEmpty)
}

// MARK: Views

/// The issue as a search answers it: without its relationships.
private func answer(_ issue: VerdandiCore.Issue) -> VerdandiCore.Issue {
  var answer = issue
  answer.parent = nil
  answer.subIssues = []
  return answer
}

@Test func viewPlacesMatchesUnderTheirAncestry() {
  var issues = Issues()
  issues.add("top", in: other, number: 1, day: 1)
  issues.add("match", number: 2, day: 2, parent: "top")
  issues.add("sibling", number: 3, day: 3, parent: "top")

  let forest = Forest.view(
    returned: [answer(issues["match"])], complete: true, issues: issues.byName, readSinceSearch: ["match"],
    tracked: [mine])

  #expect(outline(forest) == ["top", "  match", "  sibling"])
  #expect(forest.trees[0].mark == MatchMark(isMatch: false, matchesInside: 1))
  #expect(forest.trees[0].isExpanded)
  #expect(forest.trees[0].isExternal)
  #expect(forest.trees[0].subIssues[1].mark == MatchMark(isMatch: false))
  #expect(forest.missing.isEmpty)
  #expect(forest.matchCount == 1)
}

@Test func viewShowsUnreadMatchesAsAnsweredAndReadsThem() {
  var issues = Issues()
  issues.add("parent", number: 1, day: 1)
  issues.add("match", number: 2, day: 2, parent: "parent")

  let forest = Forest.view(
    returned: [answer(issues["match"])], complete: true, issues: [:], readSinceSearch: [], tracked: [mine])

  #expect(outline(forest) == ["match"])
  #expect(forest.trees[0].issue?.title == "match")
  #expect(forest.trees[0].missingParent == .loading)
  #expect(forest.missing.map(\.id) == ["match"])
}

@Test func viewRanksTreesByTheirFirstMatch() {
  var issues = Issues()
  issues.add("a", number: 1, day: 1)
  issues.add("b", number: 2, day: 2)
  issues.add("epic", number: 3, day: 3)
  issues.add("c", number: 4, day: 4, parent: "epic")

  let forest = Forest.view(
    returned: [answer(issues["b"]), answer(issues["c"]), answer(issues["a"])], complete: true,
    issues: issues.byName, readSinceSearch: ["a", "b", "c"], tracked: [mine])

  #expect(outline(forest) == ["b", "epic", "  c", "a"])
}

@Test func viewSaysWhenGitHubHidesAParent() {
  var issues = Issues()
  issues.add("match", number: 2, day: 2)
  var searched = answer(issues["match"])
  searched.hasParent = true

  let forest = Forest.view(
    returned: [searched], complete: true, issues: issues.byName, readSinceSearch: ["match"], tracked: [mine])

  #expect(forest.trees[0].missingParent == parentNotVisible)
}

@Test func viewNarrowsMatchesByItsLabelFilter() {
  var issues = Issues()
  issues.add("epic", number: 1, day: 1)
  issues.add("bug", number: 2, day: 2, labels: ["bug"], parent: "epic")
  issues.add("docs", number: 3, day: 3, labels: ["docs"], parent: "epic")

  let forest = Forest.view(
    returned: [answer(issues["docs"]), answer(issues["bug"])], labelFilter: [Label(name: "bug", color: "")],
    complete: false, issues: issues.byName, readSinceSearch: ["bug", "docs"], tracked: [mine])

  #expect(outline(forest) == ["epic", "  bug", "  docs"])
  // The epic was not returned and results are incomplete, but it lacks the label.
  #expect(forest.trees[0].mark?.mayMatch == false)
  #expect(forest.trees[0].subIssues[1].mark == MatchMark(isMatch: false))
  #expect(forest.matchCount == 1)
  #expect(forest.scopeCount == 2)
}

@Test func viewCollapsesWhatLeadsToNoMatchAndReadsItLater() {
  var issues = Issues()
  issues.add("match", number: 1, day: 1)
  issues.add("child", number: 2, day: 2, parent: "match")
  issues.add("grandchild", number: 3, day: 3, parent: "child")

  let forest = Forest.view(
    returned: [answer(issues["match"])], complete: true, issues: issues.without("child"),
    readSinceSearch: ["match"], tracked: [mine])

  #expect(!forest.trees[0].isExpanded)
  #expect(forest.belowCollapsed == ["child"])
  #expect(forest.missingShown.isEmpty)
  #expect(forest.trees[0].subIssues[0].mark?.mayMatch == false)
}

// MARK: Labels

@Test func comparesLabelsWithoutCase() {
  let labels = [Label(name: "Bug", color: "f00"), Label(name: "ui", color: "0f0")]
  #expect(labels.carriesEvery(of: [Label(name: "bug", color: "")]))
  #expect(!labels.carriesEvery(of: [Label(name: "bug", color: ""), Label(name: "docs", color: "")]))
  #expect(labels.adding(Label(name: "BUG", color: "")).count == 2)
  #expect(labels.removing(named: "UI").map(\.name) == ["Bug"])
}
