import Foundation

/// Why a list shows an issue only as another issue names it: it is being
/// read, or could not be.
public enum UnreadIssue: Sendable, Hashable {
  case loading
  case failed(GitHubError)

  /// Why it has not been read, as an issue store would say: it failed, or it
  /// is still to be read.
  public init(failure: GitHubError?) {
    self = failure.map(UnreadIssue.failed) ?? .loading
  }

  /// Whether it could not be read, rather than still to be read.
  public var isFailure: Bool {
    if case .failed = self { return true }
    return false
  }
}

/// How a view, or a list its label filter narrows, marks an issue: a match,
/// or a context issue, shown only for its place in the tree.
public struct MatchMark: Sendable, Hashable {
  public var isMatch: Bool
  /// Whether a context issue in a view may match too: the search's results
  /// are not complete, and the issue lacks no label of the label filter.
  public var mayMatch: Bool
  /// How many matches lie below it at any depth, collapsed away or not.
  public var matchesInside: Int

  public init(isMatch: Bool, mayMatch: Bool = false, matchesInside: Int = 0) {
    self.isMatch = isMatch
    self.mayMatch = mayMatch
    self.matchesInside = matchesInside
  }
}

/// A parent issue that a list names with a chip instead of showing it above
/// an issue: it lives elsewhere, or has not been read.
public struct ParentIssue: Sendable, Hashable {
  public var reference: IssueReference
  /// Whether it lives outside every tracked repository.
  public var isExternal: Bool
  /// Why it has not been read, unless it has.
  public var unread: UnreadIssue?

  public init(reference: IssueReference, isExternal: Bool, unread: UnreadIssue?) {
    self.reference = reference
    self.isExternal = isExternal
    self.unread = unread
  }
}

/// An issue in a list, with its sub-issues nested below it.
public struct ForestNode: Sendable, Hashable, Identifiable {
  /// The issue as its parent issue or a search names it.
  public var reference: IssueReference
  /// The issue as read, or as a view's search answered it; none while it
  /// shows only as its parent issue names it.
  public var issue: Issue?
  /// Why it shows only as its parent issue names it.
  public var unread: UnreadIssue?
  /// Its sub-issues in GitHub's order, read or not.
  public var subIssues: [ForestNode]
  /// Whether its sub-issues show.
  public var isExpanded: Bool
  /// How a view, or a list its label filter narrows, marks it.
  public var mark: MatchMark?
  /// Whether it lives outside every tracked repository.
  public var isExternal: Bool
  /// At the top of a list: its parent issue, which the list does not show
  /// above it.
  public var parent: ParentIssue?
  /// At the top of a view's tree: the parent issue above it that the view
  /// cannot show, yet or at all.
  public var missingParent: UnreadIssue?

  public init(
    reference: IssueReference, issue: Issue?, unread: UnreadIssue? = nil, subIssues: [ForestNode] = [],
    isExpanded: Bool = false, mark: MatchMark? = nil, isExternal: Bool = false, parent: ParentIssue? = nil,
    missingParent: UnreadIssue? = nil
  ) {
    self.reference = reference
    self.issue = issue
    self.unread = unread
    self.subIssues = subIssues
    self.isExpanded = isExpanded
    self.mark = mark
    self.isExternal = isExternal
    self.parent = parent
    self.missingParent = missingParent
  }

  public var id: String { reference.id }

  /// Whether it counts as a match: marked one, or unmarked, as in a list
  /// without a label filter.
  public var isMatch: Bool { mark?.isMatch ?? true }

  /// Every node of its tree, itself first.
  public var allNodes: [ForestNode] {
    [self] + subIssues.flatMap(\.allNodes)
  }
}

/// A row of a list as it shows, top to bottom.
public struct ForestRow: Sendable, Hashable, Identifiable {
  public var node: ForestNode
  /// How deeply it is nested: 0 at the top.
  public var depth: Int
  /// The issue it nests below, if any.
  public var parentID: String?

  public var id: String { node.id }
}

/// A list's issues arranged into their sub-issue forest.
public struct Forest: Sendable, Hashable {
  public var trees: [ForestNode]
  /// Issues the forest names but has not read, in any repository.
  public var missing: [IssueReference]
  /// Of the missing issues, those that would show only below collapsed ones.
  public var belowCollapsed: Set<String>
  /// How many matches it has, each once, collapsed away or not.
  public var matchCount: Int
  /// How many issues its scope has, as far as they have loaded: a list's
  /// issues in its state, or those a view's search returned.
  public var scopeCount: Int

  public init(
    trees: [ForestNode], missing: [IssueReference], belowCollapsed: Set<String>, matchCount: Int, scopeCount: Int
  ) {
    self.trees = trees
    self.missing = missing
    self.belowCollapsed = belowCollapsed
    self.matchCount = matchCount
    self.scopeCount = scopeCount
  }

  public static let empty = Forest(trees: [], missing: [], belowCollapsed: [], matchCount: 0, scopeCount: 0)

  /// The missing issues to read now: those that would show, not only below
  /// collapsed ones.
  public var missingShown: [String] {
    missing.map(\.id).filter { !belowCollapsed.contains($0) }
  }

  /// Every node, shown or collapsed away.
  public var allNodes: [ForestNode] { trees.flatMap(\.allNodes) }

  /// The rows that show: every tree, with the sub-issues of expanded issues.
  public var visibleRows: [ForestRow] {
    var rows: [ForestRow] = []
    func add(_ node: ForestNode, depth: Int, parentID: String?) {
      rows.append(ForestRow(node: node, depth: depth, parentID: parentID))
      guard node.isExpanded else { return }
      for subIssue in node.subIssues { add(subIssue, depth: depth + 1, parentID: node.id) }
    }
    for tree in trees { add(tree, depth: 0, parentID: nil) }
    return rows
  }

  /// The node of an issue, shown or collapsed away.
  public func node(_ id: String) -> ForestNode? {
    func find(in nodes: [ForestNode]) -> ForestNode? {
      for node in nodes {
        if node.id == id { return node }
        if let found = find(in: node.subIssues) { return found }
      }
      return nil
    }
    return find(in: trees)
  }
}

/// Which issues of a list are expanded: those the user expanded or collapsed
/// one by one, else all or none once the user said so, else the list's own
/// default for each.
public struct Expansion: Sendable, Hashable {
  /// Whether everything is expanded, once the user said so.
  public var everything: Bool?
  /// What the user chose one by one since.
  public var chosen: [String: Bool]

  public init(everything: Bool? = nil, chosen: [String: Bool] = [:]) {
    self.everything = everything
    self.chosen = chosen
  }

  public func isExpanded(_ id: String, byDefault: Bool) -> Bool {
    chosen[id] ?? everything ?? byDefault
  }

  public mutating func set(_ id: String, expanded: Bool) {
    chosen[id] = expanded
  }

  public mutating func setEverything(expanded: Bool) {
    everything = expanded
    chosen = [:]
  }
}

/// Whose issues a list lists: every tracked repository's, as All does, or
/// one repository's.
public enum ListScope: Sendable, Hashable {
  case all
  case repository(RepositoryAddress)
}

extension Issue {
  /// Whether it names its parent issue and sub-issues, as a read by node ID
  /// does; a search names neither.
  public var namesRelationships: Bool {
    (parent != nil || !hasParent) && (!subIssues.isEmpty || subIssuesTotal == 0)
  }
}

extension Forest {
  /// Arranges a list's matches, its open or its closed issues that carry
  /// every label of its label filter, into their sub-issue forest.
  ///
  /// The list's own repositories are a repository's list's one repository,
  /// or in All every tracked one. Their issues among the ancestors of the
  /// matches are listed too, open or closed, however many repositories lie
  /// in between. Below each listed issue its sub-issues nest, from any
  /// repository. An issue nested below another listed issue does not also
  /// stand at the top, where a chip names a parent issue the list does not
  /// show. A sub-issue that has not been read shows as its parent issue
  /// names it, with why.
  ///
  /// The newest stand first: each top-level issue by the newest match
  /// within its tree, collapsed or not, or by itself if there is none. An
  /// open match is as new as when it was opened, a closed one as when it
  /// was closed. Ties go to the higher number. Sub-issues keep GitHub's
  /// order.
  ///
  /// With a label filter, every issue is marked a match or a context issue,
  /// with how many matches lie below it.
  ///
  /// - Parameters:
  ///   - scopeIDs: the issues of the list's repositories in its state, as
  ///     far as they have loaded.
  ///   - issues: every issue read, by node ID.
  ///   - failures: why issues could not be read, by node ID.
  public static func list(
    scope: ListScope, state: IssueState, scopeIDs: [String], labelFilter: [Label] = [],
    issues: [String: Issue], failures: [String: GitHubError] = [:], tracked: Set<RepositoryAddress>,
    expansion: Expansion = Expansion()
  ) -> Forest {
    var builder = ListForestBuilder(
      scope: scope, state: state, labelFilter: labelFilter, issues: issues, failures: failures, tracked: tracked,
      expansion: expansion)
    return builder.build(scopeIDs: scopeIDs)
  }
}

/// The work of `Forest.list`, with what it gathers on the way.
private struct ListForestBuilder {
  let scope: ListScope
  let state: IssueState
  let labelFilter: [Label]
  let issues: [String: Issue]
  let failures: [String: GitHubError]
  let tracked: Set<RepositoryAddress>
  let expansion: Expansion

  var matches: Set<String> = []
  var missing: [IssueReference] = []
  var missingIDs: Set<String> = []
  var belowCollapsed: Set<String> = []
  var placed: Set<String> = []
  var newest: [String: Date] = [:]

  init(
    scope: ListScope, state: IssueState, labelFilter: [Label], issues: [String: Issue],
    failures: [String: GitHubError], tracked: Set<RepositoryAddress>, expansion: Expansion
  ) {
    self.scope = scope
    self.state = state
    self.labelFilter = labelFilter
    self.issues = issues
    self.failures = failures
    self.tracked = tracked
    self.expansion = expansion
  }

  var filtered: Bool { !labelFilter.isEmpty }

  func isOwn(_ repository: RepositoryAddress) -> Bool {
    switch scope {
    case .all: tracked.contains(repository)
    case .repository(let own): repository == own
    }
  }

  func isExternal(_ repository: RepositoryAddress) -> Bool {
    !tracked.contains(repository) && !isOwn(repository)
  }

  mutating func addMissing(_ reference: IssueReference) {
    if missingIDs.insert(reference.id).inserted { missing.append(reference) }
  }

  mutating func build(scopeIDs: [String]) -> Forest {
    var seen: Set<String> = []
    let inScope = scopeIDs.filter { seen.insert($0).inserted }
    let matchIDs = inScope.filter { id in
      guard let issue = issues[id] else { return false }
      return !filtered || issue.labels.carriesEvery(of: labelFilter)
    }
    matches = Set(matchIDs)

    // The ancestors of each match are climbed up to the top, through other
    // repositories too, to find the parent issues in the list's own.
    var listed: [String: Issue] = [:]
    var climbed: Set<String> = []
    for id in matchIDs {
      var current = issues[id]
      while let issue = current, climbed.insert(issue.id).inserted {
        if isOwn(issue.repository) { listed[issue.id] = issue }
        guard let parent = issue.parent else { break }
        current = issues[parent.id]
        if current == nil { addMissing(parent) }
      }
    }

    var nested: Set<String> = []
    func markNested(_ issue: Issue) {
      for reference in issue.subIssues where nested.insert(reference.id).inserted {
        if let subIssue = issues[reference.id] { markNested(subIssue) }
      }
    }
    for issue in listed.values { markNested(issue) }

    let tops = listed.values
      .filter { !nested.contains($0.id) }
      .map { issue in (issue: issue, time: newestMatch(issue) ?? timeOf(issue)) }
      .sorted { a, b in
        if a.time != b.time { return a.time > b.time }
        if a.issue.number != b.issue.number { return a.issue.number > b.issue.number }
        return a.issue.id > b.issue.id
      }
    var trees: [ForestNode] = []
    for (issue, _) in tops {
      var node = place(issue, collapsedAbove: false)
      node.parent = issue.parent.map { parent in
        ParentIssue(
          reference: parent, isExternal: isExternal(parent.repository),
          unread: issues[parent.id] == nil ? UnreadIssue(failure: failures[parent.id]) : nil)
      }
      trees.append(node)
    }
    return Forest(
      trees: trees, missing: missing, belowCollapsed: belowCollapsed, matchCount: matchIDs.count,
      scopeCount: inScope.count)
  }

  /// Places an issue with its sub-issues, below collapsed ones or not.
  mutating func place(_ issue: Issue, collapsedAbove: Bool) -> ForestNode {
    placed.insert(issue.id)
    let expanded = expansion.isExpanded(issue.id, byDefault: true)
    let hidden = collapsedAbove || !expanded
    var subIssues: [ForestNode] = []
    var matchesInside = 0
    for reference in issue.subIssues where !placed.contains(reference.id) {
      if let subIssue = issues[reference.id] {
        let node = place(subIssue, collapsedAbove: hidden)
        subIssues.append(node)
        if let mark = node.mark { matchesInside += (mark.isMatch ? 1 : 0) + mark.matchesInside }
        continue
      }
      placed.insert(reference.id)
      // A missing ancestor of a match is read whatever is collapsed.
      if hidden && !missingIDs.contains(reference.id) { belowCollapsed.insert(reference.id) }
      addMissing(reference)
      subIssues.append(
        ForestNode(
          reference: reference, issue: nil, unread: UnreadIssue(failure: failures[reference.id]),
          mark: filtered ? MatchMark(isMatch: false) : nil, isExternal: isExternal(reference.repository)))
    }
    return ForestNode(
      reference: issue.reference, issue: issue, subIssues: subIssues, isExpanded: expanded,
      mark: filtered ? MatchMark(isMatch: matches.contains(issue.id), matchesInside: matchesInside) : nil,
      isExternal: isExternal(issue.repository))
  }

  /// How new an issue is: when it was opened, or closed in a closed list.
  func timeOf(_ issue: Issue) -> Date {
    state == .closed ? (issue.closedAt ?? issue.createdAt) : issue.createdAt
  }

  /// How new the newest match within an issue's tree is, if it has one.
  mutating func newestMatch(_ issue: Issue) -> Date? {
    if let known = newest[issue.id] { return known == .distantPast ? nil : known }
    newest[issue.id] = .distantPast
    var time: Date? = matches.contains(issue.id) ? timeOf(issue) : nil
    for reference in issue.subIssues {
      guard let subIssue = issues[reference.id], let inside = newestMatch(subIssue) else { continue }
      time = max(time ?? inside, inside)
    }
    newest[issue.id] = time ?? .distantPast
    return time
  }
}
