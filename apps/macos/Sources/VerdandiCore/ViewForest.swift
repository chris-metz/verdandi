import Foundation

extension Forest {
  /// Arranges a view's matches into trees: each match under its whole
  /// ancestry, as far as it has been read, up to its top-level issue, and
  /// below each issue its sub-issues in GitHub's order, matches or context
  /// issues. Each issue appears once. A match whose relationships have not
  /// been read shows as the search answered it, as a tree of its own unless
  /// an issue shown names it as a sub-issue. The trees are in the order of
  /// the search's rank of the first match anywhere inside each.
  ///
  /// The matches are the issues the search returned that carry every label
  /// of the label filter, as last read. An issue the search did not return
  /// may match too only while the search's results are not complete.
  ///
  /// An issue on a path to a match is expanded, the others collapsed,
  /// unless the user chose otherwise. What shows is read first; of what
  /// collapsed issues hide, only what one collapsed issue hides is named
  /// missing, so the rest is read once it comes nearer.
  ///
  /// - Parameters:
  ///   - returned: the issues the search returned, in its order.
  ///   - complete: whether the search returned all it matches, so that the
  ///     context issues it did not return are known not to match.
  ///   - issues: every issue read, by node ID.
  ///   - failures: why issues could not be read, by node ID.
  ///   - readSinceSearch: the issues read by node ID since the search ran,
  ///     whose parent issue, or the lack of one, is as new as the search.
  public static func view(
    returned: [Issue], labelFilter: [Label] = [], complete: Bool, issues: [String: Issue],
    failures: [String: GitHubError] = [:], readSinceSearch: Set<String>, tracked: Set<RepositoryAddress>,
    expansion: Expansion = Expansion()
  ) -> Forest {
    var builder = ViewForestBuilder(
      labelFilter: labelFilter, complete: complete, issues: issues, failures: failures,
      readSinceSearch: readSinceSearch, tracked: tracked, expansion: expansion)
    return builder.build(returned: returned)
  }
}

/// What a view says of a parent issue that reading the match below it left
/// out: GitHub does not show it to this account.
let parentNotVisible = UnreadIssue.failed(.unavailable("GitHub does not show the parent issue to this account."))

/// The work of `Forest.view`, with what it gathers on the way.
private struct ViewForestBuilder {
  let labelFilter: [Label]
  let complete: Bool
  let issues: [String: Issue]
  let failures: [String: GitHubError]
  let readSinceSearch: Set<String>
  let tracked: Set<RepositoryAddress>
  let expansion: Expansion

  var answers: [String: Issue] = [:]
  var ranks: [String: Int] = [:]
  var matches: [Issue] = []
  var missing: [IssueReference] = []
  var missingIDs: Set<String> = []
  var placed: Set<String> = []

  init(
    labelFilter: [Label], complete: Bool, issues: [String: Issue], failures: [String: GitHubError],
    readSinceSearch: Set<String>, tracked: Set<RepositoryAddress>, expansion: Expansion
  ) {
    self.labelFilter = labelFilter
    self.complete = complete
    self.issues = issues
    self.failures = failures
    self.readSinceSearch = readSinceSearch
    self.tracked = tracked
    self.expansion = expansion
  }

  /// An issue as read with its relationships, if it has been.
  func read(_ id: String) -> Issue? {
    guard let issue = issues[id] else { return nil }
    return readSinceSearch.contains(id) || issue.namesRelationships ? issue : nil
  }

  func unread(_ reference: IssueReference) -> UnreadIssue {
    UnreadIssue(failure: failures[reference.id])
  }

  mutating func addMissing(_ reference: IssueReference) {
    if missingIDs.insert(reference.id).inserted { missing.append(reference) }
  }

  mutating func build(returned: [Issue]) -> Forest {
    for (rank, answer) in returned.enumerated() where answers[answer.id] == nil {
      answers[answer.id] = answer
      guard (read(answer.id) ?? answer).labels.carriesEvery(of: labelFilter) else { continue }
      ranks[answer.id] = rank
      matches.append(answer)
    }

    // Each match climbs to the top-most ancestor that has been read, which
    // says why the parent issue above it does not show, if one does not.
    var tops: [(id: String, missingParent: UnreadIssue?)] = []
    var topIDs: Set<String> = []
    for answer in matches {
      // A match's parent issue must be as new as the search's pointer to it.
      if !readSinceSearch.contains(answer.id) { addMissing(answer.reference) }
      var missingParent: UnreadIssue?
      var top = answer.id
      if var issue = read(answer.id) {
        var climbed: Set<String> = []
        while true {
          climbed.insert(issue.id)
          guard let parent = issue.parent else {
            // The search names a parent issue that reading the match since
            // left out: GitHub does not show it. An older read tells nothing.
            if issue.id == answer.id && answer.hasParent {
              missingParent = readSinceSearch.contains(answer.id) ? parentNotVisible : .loading
            }
            break
          }
          guard let above = read(parent.id) else {
            addMissing(parent)
            missingParent = unread(parent)
            break
          }
          if climbed.contains(above.id) { break }
          issue = above
        }
        top = issue.id
      } else if answer.hasParent {
        missingParent = unread(answer.reference)
      }
      if topIDs.insert(top).inserted { tops.append((top, missingParent)) }
    }

    // An issue that shows below another is no tree of its own.
    var nested: Set<String> = []
    func markNested(_ issue: Issue) {
      for reference in issue.subIssues where nested.insert(reference.id).inserted {
        if let subIssue = read(reference.id) { markNested(subIssue) }
      }
    }
    for (id, _) in tops {
      if let issue = read(id) { markNested(issue) }
    }

    var planted: [(node: ForestNode, firstRank: Int)] = []
    for (id, missingParent) in tops where !nested.contains(id) && !placed.contains(id) {
      guard let issue = read(id) ?? answers[id] else { continue }
      var (node, firstRank) = place(issue.reference)
      node.missingParent = missingParent
      planted.append((node, firstRank))
    }
    // A match its ancestors do not name as a sub-issue, as when GitHub
    // answered them at different times, still shows.
    for answer in matches where !placed.contains(answer.id) {
      planted.append(place((read(answer.id) ?? answer).reference))
    }
    let trees = planted.enumerated()
      .sorted { a, b in (a.element.firstRank, a.offset) < (b.element.firstRank, b.offset) }
      .map(\.element.node)

    // What shows is read first, then what one collapsed issue hides; what
    // lies further below waits until it comes nearer.
    var belowCollapsed: Set<String> = []
    var tooDeep: Set<String> = []
    func survey(_ node: ForestNode, collapsedAbove: Int) {
      if node.unread != nil {
        if collapsedAbove == 1 { belowCollapsed.insert(node.id) }
        if collapsedAbove > 1 { tooDeep.insert(node.id) }
        return
      }
      let below = collapsedAbove + (collapsedAbove > 0 || !node.isExpanded ? 1 : 0)
      for subIssue in node.subIssues { survey(subIssue, collapsedAbove: below) }
    }
    for tree in trees { survey(tree, collapsedAbove: 0) }

    return Forest(
      trees: trees, missing: missing.filter { !tooDeep.contains($0.id) }, belowCollapsed: belowCollapsed,
      matchCount: matches.count, scopeCount: answers.count)
  }

  /// Places an issue with its sub-issues, and says the rank of the first
  /// match in it.
  mutating func place(_ reference: IssueReference) -> (node: ForestNode, firstRank: Int) {
    let id = reference.id
    placed.insert(id)
    let answer = answers[id]
    let rank = ranks[id] ?? .max
    let issue = read(id)
    guard let shown = issue ?? answer else {
      addMissing(reference)
      let node = ForestNode(
        reference: reference, issue: nil, unread: unread(reference),
        mark: MatchMark(isMatch: false, mayMatch: !complete), isExternal: !tracked.contains(reference.repository))
      return (node, rank)
    }
    var subIssues: [ForestNode] = []
    var firstRank = rank
    var matchesInside = 0
    for subReference in issue?.subIssues ?? [] where !placed.contains(subReference.id) {
      let (node, subRank) = place(subReference)
      subIssues.append(node)
      firstRank = min(firstRank, subRank)
      if let mark = node.mark { matchesInside += (mark.isMatch ? 1 : 0) + mark.matchesInside }
    }
    // An issue returned but not read yet shows as the search answered it,
    // and is read for its relationships.
    if issue == nil { addMissing(reference) }
    let node = ForestNode(
      reference: shown.reference, issue: shown, subIssues: subIssues,
      isExpanded: expansion.isExpanded(id, byDefault: matchesInside > 0),
      mark: MatchMark(
        isMatch: ranks[id] != nil,
        mayMatch: answer == nil && !complete && shown.labels.carriesEvery(of: labelFilter),
        matchesInside: matchesInside),
      isExternal: !tracked.contains(shown.repository))
    return (node, firstRank)
  }
}
