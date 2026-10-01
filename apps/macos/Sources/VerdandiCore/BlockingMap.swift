import Foundation

/// One side of one issue's blocking relationships.
public struct BlockingListKey: Hashable, Sendable {
  public var issueID: String
  public var side: BlockingSide

  public init(_ issueID: String, _ side: BlockingSide) {
    self.issueID = issueID
    self.side = side
  }
}

/// What has been read of one side of an issue's blocking relationships: the
/// issues read so far, in GitHub's order, and how many there are in all.
public struct BlockingList: Hashable, Sendable {
  public var ids: [String]
  public var totalCount: Int

  public init(ids: [String], totalCount: Int) {
    self.ids = ids
    self.totalCount = totalCount
  }

  /// How many GitHub counts that have not been read, e.g. on later pages.
  public var unread: Int { max(0, totalCount - ids.count) }
}

extension Issue {
  /// How many issues are on a side of its blocking relationships, closed
  /// ones included.
  public func blockingTotal(_ side: BlockingSide) -> Int {
    side == .blockedBy ? totalBlockedBy : totalBlocking
  }

  /// How many open issues are on a side of its blocking relationships.
  public func blockingOpen(_ side: BlockingSide) -> Int {
    side == .blockedBy ? blockedBy : blocking
  }
}

/// A place on a blocking map: an issue's card, or one standing for cards
/// the map does not show.
public enum BlockingNode: Hashable, Sendable {
  case issue(String)
  /// What lies further out on a side than the map's steps reach.
  case further(BlockingSide)
  /// The cards of a column beyond those it shows.
  case more(step: Int)
}

/// An issue's blocking chains in both directions, as far as they have been
/// read: to the left the issues that block it and those that block them,
/// to the right the issues it blocks and those they block, a few steps out
/// each, across repositories. Closed issues show, and what lies behind them
/// is followed too unless `followsClosed` is false: a closed issue no
/// longer blocks anything, but its chain is how the work went.
///
/// Each issue stands in the column of its longest route from the map's
/// issue, so every arrow points outward. A route back to an issue already
/// on the way is a cycle, kept as an arrow but left out of the placement.
/// An issue on both sides shows once, on the side of its blockers.
public struct BlockingMap: Hashable, Sendable {
  public struct Card: Hashable, Sendable, Identifiable {
    public var issue: Issue
    /// Its column: 0 for the map's issue, negative for those that block
    /// it, positive for those it blocks.
    public var step: Int
    /// How many relationships on its outward side the map leaves out
    /// because they have not been read.
    public var unread: Int
    /// Whether it is closed, with relationships on its outward side that
    /// are not followed because closed issues are not.
    public var notFollowed: Bool

    public var id: String { issue.id }
  }

  /// An arrow from a blocker to an issue it blocks.
  public struct Edge: Hashable, Sendable {
    public var from: BlockingNode
    public var to: BlockingNode
    /// Whether it closes a cycle.
    public var cycle: Bool
    /// Whether one of its issues is closed, so it no longer blocks.
    public var closed: Bool

    public init(from: BlockingNode, to: BlockingNode, cycle: Bool = false, closed: Bool = false) {
      self.from = from
      self.to = to
      self.cycle = cycle
      self.closed = closed
    }
  }

  /// What lies further out on a side than the map's steps reach.
  public struct Further: Hashable, Sendable {
    /// Issues read that stand further out than the last step.
    public var folded: Int
    /// Relationships of the outermost cards that have not been read.
    public var unread: Int

    /// Whether `folded` is all there is, with nothing left unread.
    public var isExact: Bool { unread == 0 }
  }

  /// The map's issue.
  public var root: String
  /// Every card, the map's issue first.
  public var cards: [Card]
  public var edges: [Edge]
  /// What lies further out on each side, where something does.
  public var further: [BlockingSide: Further]

  /// Builds the map of `root`, `steps` out on each side, from the issues
  /// and relationships read so far. Issues not read are left out.
  public init(
    root: String,
    steps: [BlockingSide: Int] = [:],
    followsClosed: Bool = true,
    issue: (String) -> Issue?,
    list: (BlockingListKey) -> BlockingList?
  ) {
    self.root = root
    cards = []
    edges = []
    further = [:]
    guard let rootIssue = issue(root) else { return }
    var cardsByID: [String: Card] = [root: Card(issue: rootIssue, step: 0, unread: 0, notFollowed: false)]
    var order = [root]
    for side in [BlockingSide.blockedBy, .blocking] {
      let limit = max(1, steps[side] ?? 2)
      let walk = Walk(root: root, side: side, followsClosed: followsClosed, issue: issue, list: list)
      let sign = side == .blockedBy ? -1 : 1
      var folded = 0
      for id in walk.discovered {
        guard let depth = walk.depths[id], let found = issue(id) else { continue }
        if depth > limit {
          folded += 1
          continue
        }
        if id == root {
          cardsByID[root]?.unread += walk.unread[id] ?? 0
          continue
        }
        guard cardsByID[id] == nil else { continue }
        cardsByID[id] = Card(
          issue: found, step: sign * depth, unread: walk.unread[id] ?? 0,
          notFollowed: !followsClosed && found.state == .closed && found.blockingTotal(side) > 0)
        order.append(id)
      }
      let node = { (id: String) -> BlockingNode in
        (walk.depths[id] ?? 0) > limit ? .further(side) : .issue(id)
      }
      for route in walk.routes {
        let (blocker, blocked) = side == .blocking ? (route.from, route.to) : (route.to, route.from)
        let edge = Edge(
          from: node(blocker), to: node(blocked), cycle: route.cycle,
          closed: issue(blocker)?.state == .closed || issue(blocked)?.state == .closed)
        if edge.from == edge.to && !edge.cycle { continue }
        Self.add(edge, to: &edges)
      }
      // The outermost cards' unread relationships lead further out too.
      let outermost = order.compactMap { cardsByID[$0] }.filter { $0.step == sign * limit }
      let unread = outermost.reduce(0) { $0 + $1.unread }
      for card in outermost where card.unread > 0 {
        let (from, to) = side == .blocking ? (BlockingNode.issue(card.id), BlockingNode.further(side)) : (.further(side), .issue(card.id))
        Self.add(Edge(from: from, to: to, closed: card.issue.state == .closed), to: &edges)
      }
      if folded > 0 || unread > 0 {
        further[side] = Further(folded: folded, unread: unread)
      }
    }
    cards = order.compactMap { cardsByID[$0] }
  }

  /// Whether the map has anything but its own issue.
  public var isEmpty: Bool { cards.count <= 1 && further.isEmpty }

  public func card(_ id: String) -> Card? {
    cards.first { $0.id == id }
  }

  /// Adds an edge unless it is there, marking it a cycle if either says so.
  static func add(_ edge: Edge, to edges: inout [Edge]) {
    if let index = edges.firstIndex(where: { $0.from == edge.from && $0.to == edge.to }) {
      edges[index].cycle = edges[index].cycle || edge.cycle
    } else {
      edges.append(edge)
    }
  }
}

/// A walk along one side's relationships from the map's issue, depth first,
/// noting each route and the longest route to each issue.
private struct Walk {
  struct Route {
    /// The issue nearer the map's issue.
    var from: String
    var to: String
    var cycle: Bool
  }

  /// The issues reached, in the order first reached.
  var discovered: [String] = []
  var routes: [Route] = []
  /// The length of each issue's longest route from the map's issue, cycles
  /// left out.
  var depths: [String: Int] = [:]
  /// Relationships of each issue on this side that have not been read.
  var unread: [String: Int] = [:]

  init(
    root: String, side: BlockingSide, followsClosed: Bool, issue: (String) -> Issue?,
    list: (BlockingListKey) -> BlockingList?
  ) {
    var visited: Set<String> = []
    var onPath: Set<String> = []
    var finished: [String] = []
    func visit(_ id: String) {
      guard !visited.contains(id), let found = issue(id) else { return }
      visited.insert(id)
      onPath.insert(id)
      discovered.append(id)
      if id == root || followsClosed || found.state == .open {
        if let read = list(BlockingListKey(id, side)) {
          unread[id] = read.unread
          for other in read.ids where issue(other) != nil {
            let cycle = onPath.contains(other)
            routes.append(Route(from: id, to: other, cycle: cycle))
            if !cycle { visit(other) }
          }
        } else {
          unread[id] = found.blockingTotal(side)
        }
      }
      onPath.remove(id)
      finished.append(id)
    }
    visit(root)
    // Without the routes that close cycles what is left has no cycle, and
    // the reverse of the order the walk finished issues in is a topological
    // order of it: each issue's longest route is known before it is used.
    let outgoing = Dictionary(grouping: routes.filter { !$0.cycle }, by: \.from)
    depths[root] = 0
    for id in finished.reversed() {
      guard let depth = depths[id] else { continue }
      for route in outgoing[id] ?? [] {
        depths[route.to] = max(depths[route.to] ?? 0, depth + 1)
      }
    }
  }
}
