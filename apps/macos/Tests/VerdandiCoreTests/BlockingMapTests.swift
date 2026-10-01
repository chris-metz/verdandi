import Foundation
import Testing

@testable import VerdandiCore

/// A made-up set of issues and their blocking relationships, each issue
/// named by its ID.
private struct Graph {
  var issues: [String: VerdandiCore.Issue] = [:]
  var lists: [BlockingListKey: BlockingList] = [:]

  /// Adds issues, open unless named in `closed`.
  mutating func add(_ ids: [String], closed: Set<String> = []) {
    for id in ids {
      issues[id] = VerdandiCore.Issue(
        id: id, repository: RepositoryAddress(owner: "o", name: "r"), number: issues.count + 1, title: id,
        state: closed.contains(id) ? .closed : .open, url: URL(string: "https://github.com/o/r/issues/1")!,
        author: nil, createdAt: .now, closedAt: nil, labels: [], parent: nil, subIssues: [], hasParent: false,
        subIssuesTotal: 0, subIssuesCompleted: 0, blockedBy: 0, totalBlockedBy: 0, blocking: 0, totalBlocking: 0)
    }
  }

  /// Says that `blocker` blocks each of `blocked`, on both sides, as read.
  mutating func block(_ blocker: String, _ blocked: [String]) {
    for other in blocked {
      append(other, to: BlockingListKey(blocker, .blocking))
      append(blocker, to: BlockingListKey(other, .blockedBy))
    }
  }

  private mutating func append(_ id: String, to key: BlockingListKey) {
    var list = lists[key] ?? BlockingList(ids: [], totalCount: 0)
    list.ids.append(id)
    list.totalCount += 1
    lists[key] = list
    if key.side == .blocking { issues[key.issueID]?.totalBlocking += 1 } else { issues[key.issueID]?.totalBlockedBy += 1 }
  }

  func map(_ root: String, steps: Int = 2, followsClosed: Bool = true) -> BlockingMap {
    BlockingMap(
      root: root, steps: [.blockedBy: steps, .blocking: steps], followsClosed: followsClosed,
      issue: { issues[$0] }, list: { lists[$0] })
  }
}

private func steps(_ map: BlockingMap) -> [String: Int] {
  Dictionary(uniqueKeysWithValues: map.cards.map { ($0.id, $0.step) })
}

private func arrows(_ edges: [BlockingMap.Edge]) -> Set<String> {
  func name(_ node: BlockingNode) -> String {
    switch node {
    case .issue(let id): id
    case .further(let side): "further:\(side)"
    case .more(let step): "more:\(step)"
    }
  }
  return Set(edges.map { "\(name($0.from))>\(name($0.to))\($0.cycle ? " cycle" : "")" })
}

@Test func placesBlockersLeftAndBlockedRight() {
  var graph = Graph()
  graph.add(["root", "a", "b", "c", "d"])
  graph.block("a", ["root"])
  graph.block("b", ["root"])
  graph.block("root", ["c"])
  graph.block("c", ["d"])
  let map = graph.map("root")
  #expect(steps(map) == ["root": 0, "a": -1, "b": -1, "c": 1, "d": 2])
  #expect(arrows(map.edges) == ["a>root", "b>root", "root>c", "c>d"])
  #expect(map.further.isEmpty)
}

@Test func placesAnIssueByItsLongestRoute() {
  var graph = Graph()
  graph.add(["root", "a", "b"])
  graph.block("root", ["a", "b"])
  graph.block("a", ["b"])
  #expect(steps(graph.map("root")) == ["root": 0, "a": 1, "b": 2])
}

@Test func marksCyclesWithoutLoopingForever() {
  var graph = Graph()
  graph.add(["root", "a", "b"])
  graph.block("root", ["a"])
  graph.block("a", ["b"])
  graph.block("b", ["root"])
  let map = graph.map("root", steps: 3)
  // b blocks the issue, so it shows as a blocker; a, which b's blocker
  // blocks, shows further back.
  #expect(steps(map) == ["root": 0, "b": -1, "a": -2])
  let cycles = map.edges.filter(\.cycle)
  #expect(!cycles.isEmpty)
  #expect(arrows(map.edges).contains("root>a cycle"))
}

@Test func followsClosedIssuesUnlessAskedNotTo() {
  var graph = Graph()
  graph.add(["root", "a", "b"], closed: ["a"])
  graph.block("root", ["a"])
  graph.block("a", ["b"])
  let map = graph.map("root")
  #expect(steps(map) == ["root": 0, "a": 1, "b": 2])
  #expect(map.edges.allSatisfy { $0.closed })

  let open = graph.map("root", followsClosed: false)
  #expect(steps(open) == ["root": 0, "a": 1])
  #expect(open.card("a")?.notFollowed == true)
}

@Test func foldsWhatLiesBeyondTheLastStep() {
  var graph = Graph()
  graph.add(["root", "a", "b", "c", "d"])
  graph.block("root", ["a"])
  graph.block("a", ["b"])
  graph.block("b", ["c"])
  graph.block("c", ["d"])
  let map = graph.map("root")
  #expect(steps(map) == ["root": 0, "a": 1, "b": 2])
  #expect(map.further[.blocking] == BlockingMap.Further(folded: 2, unread: 0))
  #expect(map.further[.blocking]?.isExact == true)
  #expect(arrows(map.edges) == ["root>a", "a>b", "b>further:blocking"])
}

@Test func countsRelationshipsNotRead() {
  var graph = Graph()
  graph.add(["root", "a", "b"])
  graph.block("root", ["a"])
  graph.block("a", ["b"])
  // a's own list has not been read, though GitHub counts 3 it blocks.
  graph.lists[BlockingListKey("a", .blocking)] = nil
  graph.issues["a"]?.totalBlocking = 3
  let map = graph.map("root")
  #expect(steps(map) == ["root": 0, "a": 1])
  #expect(map.card("a")?.unread == 3)
  #expect(map.further.isEmpty)

  // At the last step, they lead further out, by a count not known exactly.
  let short = graph.map("root", steps: 1)
  #expect(short.further[.blocking] == BlockingMap.Further(folded: 0, unread: 3))
  #expect(arrows(short.edges).contains("a>further:blocking"))
}

@Test func showsAnIssueOnBothSidesOnce() {
  var graph = Graph()
  graph.add(["root", "a"])
  graph.block("root", ["a"])
  graph.block("a", ["root"])
  let map = graph.map("root")
  #expect(steps(map) == ["root": 0, "a": -1])
  #expect(arrows(map.edges) == ["a>root cycle", "root>a cycle"])
}

@Test func laysOutColumnsWithTitles() {
  var graph = Graph()
  graph.add(["root", "a", "b", "c"])
  graph.block("a", ["root"])
  graph.block("root", ["b"])
  graph.block("b", ["c"])
  let layout = BlockingMapLayout(graph.map("root"))
  #expect(layout.columns.map(\.step) == [-1, 0, 1, 2])
  #expect(layout.columns.map(\.title) == ["Blocked by", "This issue", "Blocks", "2 steps on"])
}

@Test func truncatesLongColumnsBehindMore() {
  var graph = Graph()
  let blocked = (1...9).map { "x\($0)" }
  graph.add(["root", "y"] + blocked)
  graph.block("root", blocked)
  graph.block("x9", ["y"])
  let layout = BlockingMapLayout(graph.map("root"), cardsPerColumn: 4)
  let column = layout.columns.first { $0.step == 1 }
  #expect(column?.nodes.count == 5)
  #expect(column?.nodes.last == .more(step: 1, count: 5))
  // y's blocker does not show, so its arrow starts at what stands for it.
  #expect(arrows(layout.edges).contains("more:1>y"))
  #expect(!arrows(layout.edges).contains("root>x9"))

  let expanded = BlockingMapLayout(graph.map("root"), cardsPerColumn: 4, expanded: [1])
  #expect(expanded.columns.first { $0.step == 1 }?.nodes.count == 9)
}

@Test func ordersColumnsToAvoidCrossings() {
  var graph = Graph()
  graph.add(["root", "a", "b", "a2", "b2"])
  graph.block("root", ["a", "b"])
  graph.block("a", ["a2"])
  graph.block("b", ["b2"])
  var map = graph.map("root")
  // Found in the other order, b's issue would show above a's and cross it.
  map.cards.sort { ["root", "a", "b", "b2", "a2"].firstIndex(of: $0.id)! < ["root", "a", "b", "b2", "a2"].firstIndex(of: $1.id)! }
  let layout = BlockingMapLayout(map)
  #expect(layout.columns.first { $0.step == 1 }?.nodes.map(\.id) == [.issue("a"), .issue("b")])
  #expect(layout.columns.first { $0.step == 2 }?.nodes.map(\.id) == [.issue("a2"), .issue("b2")])
}

@Test func addsAColumnForWhatLiesFurther() {
  var graph = Graph()
  graph.add(["root", "a", "b", "c"])
  graph.block("c", ["b"])
  graph.block("b", ["a"])
  graph.block("a", ["root"])
  let layout = BlockingMapLayout(graph.map("root", steps: 1))
  #expect(layout.columns.map(\.step) == [-2, -1, 0])
  #expect(layout.columns.first?.title == "Further back")
  #expect(arrows(layout.edges).contains("further:blockedBy>a"))
}

@Test func movesBetweenColumnsByHeight() {
  var graph = Graph()
  graph.add(["root", "a", "b", "c", "d"])
  graph.block("a", ["root"])
  graph.block("b", ["root"])
  graph.block("c", ["root"])
  graph.block("root", ["d"])
  let layout = BlockingMapLayout(graph.map("root"))
  #expect(layout.neighbour(of: .issue("root"), toward: .left) == .issue("b"))
  #expect(layout.neighbour(of: .issue("a"), toward: .right) == .issue("root"))
  #expect(layout.neighbour(of: .issue("root"), toward: .right) == .issue("d"))
  #expect(layout.neighbour(of: .issue("d"), toward: .right) == nil)
  #expect(layout.neighbour(of: .issue("b"), toward: .down) == .issue("c"))
  #expect(layout.neighbour(of: .issue("a"), toward: .up) == nil)
}

@Test func readsLinksToIssues() {
  let link = IssueLink(URL(string: "https://github.com/chris-metz/verdandi/issues/4#issuecomment-5845909562")!)
  #expect(link == IssueLink(repository: RepositoryAddress(owner: "chris-metz", name: "verdandi"), number: 4))
  #expect(IssueLink(URL(string: "https://github.com/cli/cli/pull/12")!) == nil)
  #expect(IssueLink(URL(string: "https://github.com/cli/cli/issues")!) == nil)
  #expect(IssueLink(URL(string: "http://github.com/cli/cli/issues/3")!) == nil)
  #expect(IssueLink(URL(string: "https://example.com/cli/cli/issues/3")!) == nil)
}
