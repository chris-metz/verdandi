import Foundation
import Testing

@testable import VerdandiCore

@Test func movesThroughParentsTheIssueAndSubIssuesInOrder() {
  let page = PageTargets(issueID: "root", parents: ["top", "parent"], subIssues: ["s1", "s2"])
  #expect(page.move(.issue, toward: .up) == .parent("parent"))
  #expect(page.move(.parent("parent"), toward: .up) == .parent("top"))
  #expect(page.move(.parent("top"), toward: .up) == nil)
  #expect(page.move(.parent("top"), toward: .down) == .parent("parent"))
  #expect(page.move(.issue, toward: .down) == .subIssue("s1"))
  #expect(page.move(.subIssue("s1"), toward: .down) == .subIssue("s2"))
  #expect(page.move(.subIssue("s2"), toward: .down) == nil)
  #expect(page.move(.subIssue("s1"), toward: .up) == .issue)
  #expect(page.move(.issue, toward: .left) == nil)
  #expect(page.move(.subIssue("s1"), toward: .right) == nil)
}

/// A page whose issue `root` is blocked by `a` and `b` and blocks `c`, with
/// a parent issue and a sub-issue.
private func pageWithMap() -> PageTargets {
  var graph = Graph()
  graph.add(["root", "a", "b", "c"])
  graph.block("a", ["root"])
  graph.block("b", ["root"])
  graph.block("root", ["c"])
  return PageTargets(
    issueID: "root", parents: ["parent"], map: BlockingMapLayout(graph.map("root")), subIssues: ["s1"])
}

@Test func movesIntoTheMapFromItsIssueAndOutAtAColumnsEnds() {
  let page = pageWithMap()
  #expect(page.move(.issue, toward: .left) == .map(.issue("a")))
  #expect(page.move(.issue, toward: .right) == .map(.issue("c")))
  #expect(page.move(.map(.issue("a")), toward: .down) == .map(.issue("b")))
  #expect(page.move(.map(.issue("b")), toward: .right) == .issue)
  #expect(page.move(.map(.issue("a")), toward: .up) == .parent("parent"))
  #expect(page.move(.map(.issue("b")), toward: .down) == .subIssue("s1"))
  #expect(page.move(.map(.issue("c")), toward: .right) == nil)
  #expect(page.move(.issue, toward: .up) == .parent("parent"))
  #expect(page.move(.issue, toward: .down) == .subIssue("s1"))
  #expect(page.move(.subIssue("s1"), toward: .up) == .issue)
}

@Test func standsOnTheIssueWhenWhatItWasOnIsGone() {
  let page = pageWithMap()
  #expect(page.shown(.subIssue("s1")) == .subIssue("s1"))
  #expect(page.shown(.map(.issue("a"))) == .map(.issue("a")))
  #expect(page.shown(.subIssue("gone")) == .issue)
  #expect(page.shown(.parent("gone")) == .issue)
  #expect(page.shown(.map(.issue("gone"))) == .issue)
  #expect(PageTargets(issueID: "root").shown(.map(.issue("a"))) == .issue)
}

@Test func goesToTheFirstCardAColumnShowsOnceExpanded() {
  var graph = Graph()
  let blockers = (1...8).map { "a\($0)" }
  graph.add(["root"] + blockers)
  for blocker in blockers { graph.block(blocker, ["root"]) }
  let folded = PageTargets(issueID: "root", map: BlockingMapLayout(graph.map("root"), cardsPerColumn: 6))
  #expect(folded.shown(.map(.more(step: -1))) == .map(.more(step: -1)))
  let expanded = PageTargets(
    issueID: "root", map: BlockingMapLayout(graph.map("root"), cardsPerColumn: 6, expanded: [-1]))
  #expect(expanded.shown(.map(.more(step: -1))) == .map(.issue("a7")))
}

@Test func goesToTheChainReadFurther() {
  var graph = Graph()
  graph.add(["root", "a", "b", "c"])
  graph.block("c", ["b"])
  graph.block("b", ["a"])
  graph.block("a", ["root"])
  let near = PageTargets(issueID: "root", map: BlockingMapLayout(graph.map("root", steps: 1)))
  #expect(near.shown(.map(.further(.blockedBy))) == .map(.further(.blockedBy)))
  let far = PageTargets(issueID: "root", map: BlockingMapLayout(graph.map("root", steps: 3)))
  #expect(far.shown(.map(.further(.blockedBy))) == .map(.issue("c")))
}

@Test func namesTheIssueUnderTheCursor() {
  #expect(PageCursor.parent("parent").issueID(root: "root") == "parent")
  #expect(PageCursor.issue.issueID(root: "root") == "root")
  #expect(PageCursor.map(.issue("a")).issueID(root: "root") == "a")
  #expect(PageCursor.subIssue("s1").issueID(root: "root") == "s1")
  #expect(PageCursor.map(.more(step: -1)).issueID(root: "root") == nil)
  #expect(PageCursor.map(.further(.blocking)).issueID(root: "root") == nil)
}

@Test func takesTheMapsMiddleCardForTheIssue() {
  #expect(PageCursor(.issue("root"), root: "root") == .issue)
  #expect(PageCursor(.issue("a"), root: "root") == .map(.issue("a")))
  #expect(PageCursor.issue.mapNode(root: "root") == .issue("root"))
  #expect(PageCursor.map(.more(step: 1)).mapNode(root: "root") == .more(step: 1))
  #expect(PageCursor.subIssue("s1").mapNode(root: "root") == nil)
}
