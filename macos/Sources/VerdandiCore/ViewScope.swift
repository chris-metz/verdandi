import Foundation

/// What a view's search covers, as far as its `repo:`, `org:` and `user:`
/// qualifiers say; the rest of the search is GitHub's to judge. It comes
/// from the search text alone, never from the tracked repositories.
public struct ViewScope: Sendable, Hashable {
  /// A repository, `owner/name`, or an owner whose repositories are searched.
  public enum Target: Sendable, Hashable {
    case repository(String)
    case owner(String)
  }

  /// The repositories and owners the search is limited to, in search order,
  /// or `nil` when it searches every repository the account can read.
  public var targets: [Target]?
  /// Several `repo:` qualifiers side by side without `OR`, which advanced
  /// search combines with AND, so that the search matches nothing.
  public var combinedRepositories: [String]?

  /// Describes what a search covers.
  public init(query: String) {
    var parser = Parser(tokens: Self.tokens(of: query))
    let root = parser.alternatives()
    targets = root.flatMap(Self.restriction).map(Self.distinct)
    combinedRepositories = root.flatMap(Self.combined)
  }

  // MARK: Reading the search

  /// A search as advanced search reads it: terms side by side, or joined by
  /// `AND`, must all hold; `OR` joins alternatives and binds less tightly;
  /// parentheses group.
  indirect enum Node {
    case term(Target?)
    case and([Node])
    case or([Node])
  }

  /// Splits a search into terms, keeping quoted text and parentheses whole.
  static func tokens(of query: String) -> [String] {
    query.matches(of: /[()]|(?:"[^"]*"?|[^\s()"])+/).map { String($0.output) }
  }

  /// Reads the terms as a tree, forgiving what GitHub would reject, such as
  /// unbalanced parentheses: what can be read still names its scope.
  struct Parser {
    var tokens: [String]
    var position = 0
    var depth = 0

    mutating func alternatives() -> Node? {
      var nodes: [Node] = []
      while true {
        if let node = conjunction() { nodes.append(node) }
        guard position < tokens.count, tokens[position] == "OR" else { break }
        position += 1
      }
      return nodes.count > 1 ? .or(nodes) : nodes.first
    }

    mutating func conjunction() -> Node? {
      var nodes: [Node] = []
      while position < tokens.count {
        let token = tokens[position]
        if token == "OR" { break }
        position += 1
        if token == ")" {
          // A stray `)` closes nothing, and ends only a group it closes.
          if depth > 0 { break }
          continue
        }
        if token == "AND" { continue }
        if token == "(" {
          depth += 1
          let inner = alternatives()
          depth -= 1
          if let inner { nodes.append(inner) }
          continue
        }
        if token == "NOT" {
          if position < tokens.count, tokens[position] != "(", tokens[position] != ")" { position += 1 }
          nodes.append(.term(nil))
          continue
        }
        nodes.append(.term(ViewScope.target(of: token)))
      }
      return nodes.count > 1 ? .and(nodes) : nodes.first
    }
  }

  /// The repository or owner a term narrows the search to, if it does.
  static func target(of term: String) -> Target? {
    guard let match = term.wholeMatch(of: /(?i)(repo|org|user):(.+)/) else { return nil }
    let value = String(match.2).trimmingCharacters(in: CharacterSet(charactersIn: "\""))
    guard !value.isEmpty else { return nil }
    return match.1.lowercased() == "repo" ? .repository(value) : .owner(value)
  }

  /// The targets a part of the search is limited to, or `nil` when it is
  /// not limited: an alternative without a limit lifts it.
  static func restriction(_ node: Node) -> [Target]? {
    switch node {
    case .term(let target):
      return target.map { [$0] }
    case .or(let nodes):
      let parts = nodes.map(restriction)
      return parts.allSatisfy { $0 != nil } ? parts.compactMap { $0 }.flatMap { $0 } : nil
    case .and(let nodes):
      let limited = nodes.compactMap(restriction)
      return limited.isEmpty ? nil : limited.flatMap { $0 }
    }
  }

  /// The repositories a part of the search is limited to, by `repo:` alone.
  static func repositories(_ node: Node) -> [String]? {
    guard let targets = restriction(node) else { return nil }
    var names: [String] = []
    for target in targets {
      guard case .repository(let name) = target else { return nil }
      names.append(name)
    }
    return names
  }

  /// The repositories of the first conjunction whose parts each limit the
  /// search to repositories no other part allows.
  static func combined(_ node: Node) -> [String]? {
    switch node {
    case .term:
      return nil
    case .and(let nodes):
      let limits = nodes.compactMap(repositories)
      let sets = limits.map { Set($0.map { $0.lowercased() }) }
      let allowedByAll = sets.first?.contains { name in sets.dropFirst().allSatisfy { $0.contains(name) } } ?? true
      if sets.count > 1, !allowedByAll {
        var seen: Set<String> = []
        return limits.flatMap { $0 }.filter { seen.insert($0.lowercased()).inserted }
      }
      return nodes.lazy.compactMap(combined).first
    case .or(let nodes):
      return nodes.lazy.compactMap(combined).first
    }
  }

  /// Each target once, whatever its case, in the order first named.
  static func distinct(_ targets: [Target]) -> [Target] {
    var seen: Set<String> = []
    return targets.filter { target in
      let key =
        switch target {
        case .repository(let name): "repository:\(name.lowercased())"
        case .owner(let login): "owner:\(login.lowercased())"
        }
      return seen.insert(key).inserted
    }
  }
}
