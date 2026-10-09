import Foundation

/// What a view's search covers, as far as its `repo:`, `org:` and `user:`
/// qualifiers say; the rest of the search is GitHub's to check. It comes from
/// the search text alone, never from the tracked repositories, as the core's
/// `view-scope.ts` reads it for the desktop's view dialog.
struct ViewScope: Equatable {
    /// A repository, `owner/name`, or an owner whose repositories are searched.
    enum Target: Equatable {
        case repository(String)
        case owner(String)

        var name: String {
            switch self {
            case .repository(let name): name
            case .owner(let login): "\(login)’s repositories"
            }
        }

        fileprivate var key: String {
            switch self {
            case .repository(let name): "repository:\(name.lowercased())"
            case .owner(let login): "owner:\(login.lowercased())"
            }
        }
    }

    /// The repositories and owners the search is limited to, in search
    /// order, or none when it searches every repository the account reads.
    var targets: [Target]?
    /// The repositories of `repo:` qualifiers side by side without `OR`,
    /// which advanced search combines with AND, so the search matches nothing.
    var combinedRepositories: [String]?

    init(query: String) {
        var parser = Parser(tokens: Self.tokens(of: query))
        guard let root = parser.alternatives() else { return }
        targets = Self.restriction(of: root).map(Self.distinct)
        combinedRepositories = Self.combined(in: root)
    }

    /// The line under the search saying what it covers.
    var description: String {
        guard let targets else { return "Searches every repository you can read on GitHub, tracked or not." }
        return
            "Searches only \(Self.listed(targets.map(\.name))). Adding or removing tracked repositories never changes that."
    }

    /// The warning when repositories are combined so that nothing matches.
    var warning: String? {
        guard let combinedRepositories else { return nil }
        let joined = combinedRepositories.map { "repo:\($0)" }.joined(separator: " OR ")
        return
            "Several repo: qualifiers without OR must all hold at once, so this matches nothing. Join them with OR: (\(joined))."
    }

    // MARK: Reading the search

    /// A search as GitHub's advanced search reads it: terms side by side, or
    /// joined by `AND`, must all hold; `OR` joins alternatives, and binds
    /// less tightly; parentheses group.
    fileprivate indirect enum Node {
        case term(Target?)
        case and([Node])
        case or([Node])
    }

    /// Splits a search into terms, keeping quoted text and parentheses whole.
    private static func tokens(of query: String) -> [String] {
        query.matches(of: #/[()]|(?:"[^"]*"?|[^\s()"])+/#).map { String($0.output) }
    }

    /// Reads the terms as a tree, forgiving what GitHub would reject, such
    /// as unbalanced parentheses: what can be read of it still names its scope.
    private struct Parser {
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
                if token == ")" {
                    position += 1
                    // A stray `)` closes nothing, and ends only a group it closes.
                    if depth > 0 { break }
                    continue
                }
                position += 1
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
    private static func target(of term: String) -> Target? {
        guard let colon = term.firstIndex(of: ":") else { return nil }
        let qualifier = term[..<colon].lowercased()
        var value = term[term.index(after: colon)...]
        if value.hasPrefix("\"") { value = value.dropFirst() }
        if value.hasSuffix("\"") { value = value.dropLast() }
        guard !value.isEmpty else { return nil }
        switch qualifier {
        case "repo": return .repository(String(value))
        case "org", "user": return .owner(String(value))
        default: return nil
        }
    }

    /// The repositories and owners a part of the search is limited to, or
    /// none when it is not limited: an alternative without a limit lifts it.
    private static func restriction(of node: Node) -> [Target]? {
        switch node {
        case .term(let target):
            return target.map { [$0] }
        case .or(let nodes):
            let parts = nodes.map(restriction(of:))
            return parts.allSatisfy { $0 != nil } ? parts.flatMap { $0 ?? [] } : nil
        case .and(let nodes):
            let limited = nodes.compactMap(restriction(of:))
            return limited.isEmpty ? nil : limited.flatMap { $0 }
        }
    }

    /// The repositories a part of the search is limited to, by `repo:` alone.
    private static func repositories(of node: Node) -> [String]? {
        guard let restriction = restriction(of: node) else { return nil }
        var names: [String] = []
        for target in restriction {
            guard case .repository(let name) = target else { return nil }
            names.append(name)
        }
        return names
    }

    /// The repositories of the first conjunction whose parts each limit the
    /// search to repositories that no other part allows.
    private static func combined(in node: Node) -> [String]? {
        switch node {
        case .term:
            return nil
        case .and(let nodes):
            let limits = nodes.compactMap(repositories(of:))
            let sets = limits.map { Set($0.map { $0.lowercased() }) }
            if let first = sets.first, sets.count > 1,
                !first.contains(where: { name in sets.dropFirst().allSatisfy { $0.contains(name) } })
            {
                var seen = Set<String>()
                return limits.flatMap { $0 }.filter { seen.insert($0.lowercased()).inserted }
            }
            return nodes.lazy.compactMap(combined(in:)).first
        case .or(let nodes):
            return nodes.lazy.compactMap(combined(in:)).first
        }
    }

    /// Each target once, whatever its case, in the order first named.
    private static func distinct(_ targets: [Target]) -> [Target] {
        var seen = Set<String>()
        return targets.filter { seen.insert($0.key).inserted }
    }

    /// Names joined as a sentence would: "a, b or c".
    private static func listed(_ names: [String]) -> String {
        guard names.count > 1, let last = names.last else { return names.last ?? "" }
        return "\(names.dropLast().joined(separator: ", ")) or \(last)"
    }
}
