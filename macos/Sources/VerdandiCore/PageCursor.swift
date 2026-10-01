import Foundation

/// What the keyboard is on in an issue's page: one of its parent issues,
/// the issue itself, a node of its blocking map, or one of its sub-issues.
public enum PageCursor: Hashable, Sendable {
  case parent(String)
  /// The page's issue, which is also its blocking map's middle card.
  case issue
  /// A node of the blocking map other than its middle card.
  case map(BlockingNode)
  case subIssue(String)
}

extension PageCursor {
  /// The cursor on a node of the map of the issue `root`, whose middle card
  /// is the issue.
  public init(_ node: BlockingNode, root: String) {
    self = node == .issue(root) ? .issue : .map(node)
  }

  /// The node of the map of the issue `root` it is on, if it is on the map.
  public func mapNode(root: String) -> BlockingNode? {
    switch self {
    case .issue: .issue(root)
    case .map(let node): node
    case .parent, .subIssue: nil
    }
  }

  /// The issue it is on, on the page of the issue `root`, unless it is on a
  /// map node that stands for cards the map does not show.
  public func issueID(root: String) -> String? {
    switch self {
    case .parent(let id), .subIssue(let id), .map(.issue(let id)): id
    case .issue: root
    case .map(.more), .map(.further): nil
    }
  }
}

/// What an issue page's cursor can be on, in the order the page shows it:
/// its parent issues, top first, the issue with its blocking map, and its
/// sub-issues.
public struct PageTargets: Hashable, Sendable {
  public var issueID: String
  public var parents: [String]
  /// The blocking map, if the page shows one.
  public var map: BlockingMapLayout?
  public var subIssues: [String]

  public init(issueID: String, parents: [String] = [], map: BlockingMapLayout? = nil, subIssues: [String] = []) {
    self.issueID = issueID
    self.parents = parents
    self.map = map
    self.subIssues = subIssues
  }

  /// Where a move from `cursor` lands, or nil where nothing lies that way.
  /// Up and down go through the targets in order; on the map, every way
  /// goes to the card that lies that way, and up or down past a column's
  /// ends leaves the map for the parent issue or the first sub-issue.
  public func move(_ cursor: PageCursor, toward direction: MapDirection) -> PageCursor? {
    if let map, let node = cursor.mapNode(root: issueID), map.contains(node) {
      if let next = map.neighbour(of: node, toward: direction) { return PageCursor(next, root: issueID) }
      switch direction {
      case .up: return parents.last.map(PageCursor.parent)
      case .down: return subIssues.first.map(PageCursor.subIssue)
      case .left, .right: return nil
      }
    }
    let order = parents.map(PageCursor.parent) + [.issue] + subIssues.map(PageCursor.subIssue)
    guard let index = order.firstIndex(of: cursor) else { return nil }
    switch direction {
    case .up: return index > 0 ? order[index - 1] : nil
    case .down: return index + 1 < order.count ? order[index + 1] : nil
    case .left, .right: return nil
    }
  }

  /// Where the cursor shows. It stays where it is while the page shows
  /// that. When a map node goes, the cursor goes to what took its place:
  /// from "+N more" to the first card it stood for, once its column shows
  /// them all; from "Further" to the outermost column on its side, once the
  /// chain was read further. When anything else goes, it goes to the issue.
  public func shown(_ cursor: PageCursor) -> PageCursor {
    switch cursor {
    case .issue: return .issue
    case .parent(let id): return parents.contains(id) ? cursor : .issue
    case .subIssue(let id): return subIssues.contains(id) ? cursor : .issue
    case .map(let node):
      guard let map, map.contains(.issue(issueID)), node != .issue(issueID) else { return .issue }
      if map.contains(node) { return cursor }
      return successor(of: node, in: map).map(PageCursor.map) ?? .issue
    }
  }

  private func successor(of node: BlockingNode, in map: BlockingMapLayout) -> BlockingNode? {
    switch node {
    case .issue: return nil
    case .more(let step):
      let nodes = map.columns.first { $0.step == step }?.nodes ?? []
      return nodes.indices.contains(map.cardsPerColumn) ? nodes[map.cardsPerColumn].id : nil
    case .further(let side):
      guard let column = side == .blockedBy ? map.columns.first : map.columns.last, column.step != 0 else {
        return nil
      }
      return column.nodes[(column.nodes.count - 1) / 2].id
    }
  }
}
