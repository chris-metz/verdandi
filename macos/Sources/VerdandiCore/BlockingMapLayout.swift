import Foundation

/// A blocking map in columns, one per step: the map's issue in the middle,
/// its blockers to the left and what it blocks to the right. Each column is
/// ordered so arrows cross as little as they can, and shows at most a few
/// cards unless expanded, the rest standing behind a "+N more" node. The
/// arrows run between what shows: one to a card that does not show ends at
/// what stands for it.
public struct BlockingMapLayout: Hashable, Sendable {
  public enum Node: Hashable, Sendable, Identifiable {
    case card(BlockingMap.Card)
    /// A column's cards beyond those it shows.
    case more(step: Int, count: Int)
    /// What lies further out on a side than the map's steps reach.
    case further(BlockingSide, BlockingMap.Further)

    public var id: BlockingNode {
      switch self {
      case .card(let card): .issue(card.id)
      case .more(let step, _): .more(step: step)
      case .further(let side, _): .further(side)
      }
    }
  }

  public struct Column: Hashable, Sendable, Identifiable {
    public var step: Int
    public var nodes: [Node]
    public var id: Int { step }

    /// What the column's header says.
    public var title: String {
      switch nodes.first {
      case .further(let side, _): return side == .blockedBy ? "Further back" : "Further on"
      default: break
      }
      switch step {
      case -1: return "Blocked by"
      case 0: return "This issue"
      case 1: return "Blocks"
      default: return "\(abs(step)) steps \(step < 0 ? "back" : "on")"
      }
    }
  }

  /// The columns, left to right.
  public var columns: [Column]
  public var edges: [BlockingMap.Edge]
  /// The most cards a column shows unless expanded.
  public var cardsPerColumn: Int

  /// Lays out a map, each column showing at most `cardsPerColumn` cards
  /// unless its step is in `expanded`.
  public init(_ map: BlockingMap, cardsPerColumn: Int = 6, expanded: Set<Int> = []) {
    self.cardsPerColumn = max(1, cardsPerColumn)
    let discovery = Dictionary(uniqueKeysWithValues: map.cards.enumerated().map { ($1.id, $0) })
    let byStep = Dictionary(grouping: map.cards, by: \.step)
    // Where each node shows, as its offset from its column's middle.
    var offsets: [BlockingNode: Double] = [:]
    // What a card that does not show is drawn as.
    var standIn: [BlockingNode: BlockingNode] = [:]
    var columns: [Int: Column] = [:]
    let steps = byStep.keys
    let sides: [[Int]] = [
      [0], Array((steps.filter { $0 > 0 }).sorted()), Array((steps.filter { $0 < 0 }).sorted(by: >)),
    ]
    for step in sides.joined() {
      let cards = byStep[step] ?? []
      // The middle of a card's neighbours nearer the map's issue, which
      // already show.
      func barycenter(_ card: BlockingMap.Card) -> Double {
        let inner = map.edges.compactMap { edge -> BlockingNode? in
          guard !edge.cycle else { return nil }
          if step > 0, edge.to == .issue(card.id) { return edge.from }
          if step < 0, edge.from == .issue(card.id) { return edge.to }
          return nil
        }
        let known = inner.compactMap { offsets[standIn[$0] ?? $0] }
        return known.isEmpty ? 0 : known.reduce(0, +) / Double(known.count)
      }
      let centres = Dictionary(uniqueKeysWithValues: cards.map { ($0.id, barycenter($0)) })
      let ordered = cards.sorted {
        let (a, b) = (centres[$0.id] ?? 0, centres[$1.id] ?? 0)
        return a != b ? a < b : (discovery[$0.id] ?? 0) < (discovery[$1.id] ?? 0)
      }
      let limit = expanded.contains(step) || step == 0 ? ordered.count : self.cardsPerColumn
      var nodes = ordered.prefix(limit).map(Node.card)
      if ordered.count > limit {
        nodes.append(.more(step: step, count: ordered.count - limit))
        for hidden in ordered.dropFirst(limit) { standIn[.issue(hidden.id)] = .more(step: step) }
      }
      for (index, node) in nodes.enumerated() {
        offsets[node.id] = Double(index) - Double(nodes.count - 1) / 2
      }
      columns[step] = Column(step: step, nodes: nodes)
    }
    for (side, further) in map.further {
      let outermost = side == .blockedBy ? (steps.min() ?? 0) : (steps.max() ?? 0)
      let step = outermost + (side == .blockedBy ? -1 : 1)
      columns[step] = Column(step: step, nodes: [.further(side, further)])
    }
    self.columns = columns.keys.sorted().compactMap { columns[$0] }

    var edges: [BlockingMap.Edge] = []
    for edge in map.edges {
      var shown = edge
      shown.from = standIn[edge.from] ?? edge.from
      shown.to = standIn[edge.to] ?? edge.to
      if shown.from == shown.to { continue }
      BlockingMap.add(shown, to: &edges)
    }
    self.edges = edges
  }

  /// Where a node shows: its column's index and its index in that column.
  public func position(of node: BlockingNode) -> (column: Int, row: Int)? {
    for (column, entry) in columns.enumerated() {
      if let row = entry.nodes.firstIndex(where: { $0.id == node }) { return (column, row) }
    }
    return nil
  }

  public func contains(_ node: BlockingNode) -> Bool {
    position(of: node) != nil
  }

  /// The node a move from `node` lands on, if any. Left and right go to the
  /// next column's node nearest in height, as columns are centred; up and
  /// down stay in the column.
  public func neighbour(of node: BlockingNode, toward direction: MapDirection) -> BlockingNode? {
    guard let (column, row) = position(of: node) else { return nil }
    let nodes = columns[column].nodes
    switch direction {
    case .up: return row > 0 ? nodes[row - 1].id : nil
    case .down: return row + 1 < nodes.count ? nodes[row + 1].id : nil
    case .left, .right:
      let next = column + (direction == .left ? -1 : 1)
      guard columns.indices.contains(next) else { return nil }
      let offset = Double(row) - Double(nodes.count - 1) / 2
      let targets = columns[next].nodes
      let nearest = targets.indices.min {
        let a = abs(Double($0) - Double(targets.count - 1) / 2 - offset)
        let b = abs(Double($1) - Double(targets.count - 1) / 2 - offset)
        return a != b ? a < b : $0 < $1
      }
      return nearest.map { targets[$0].id }
    }
  }
}

/// A direction to move on a blocking map.
public enum MapDirection: Sendable, Hashable {
  case left, right, up, down
}
