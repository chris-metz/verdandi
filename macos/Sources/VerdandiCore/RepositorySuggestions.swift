import Foundation

extension RepositoryAddress {
  /// Reads what someone types or pastes to name a repository: `owner/name`,
  /// or a GitHub URL of it or of anything in it, such as an issue, with or
  /// without `https://`, or its `git@github.com:` clone address.
  public static func fromInput(_ input: String) -> RepositoryAddress? {
    var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
    if let address = RepositoryAddress(text) { return address }
    for prefix in ["git@github.com:", "ssh://git@github.com/", "https://", "http://"]
    where text.lowercased().hasPrefix(prefix) {
      text = String(text.dropFirst(prefix.count))
      if prefix.hasPrefix("git") || prefix.hasPrefix("ssh") { text = "github.com/" + text }
      break
    }
    if text.lowercased().hasPrefix("www.") { text = String(text.dropFirst(4)) }
    guard text.lowercased().hasPrefix("github.com/") else { return nil }
    let path = text.dropFirst("github.com/".count).split(separator: "/", omittingEmptySubsequences: false)
    guard path.count >= 2 else { return nil }
    var name = String(path[1].prefix { $0 != "?" && $0 != "#" })
    if name.lowercased().hasSuffix(".git") { name = String(name.dropLast(4)) }
    return RepositoryAddress("\(path[0])/\(name)")
  }
}

/// The repositories the picker suggests of one owner.
public struct SuggestionGroup: Sendable, Hashable, Identifiable {
  public enum Kind: Sendable, Hashable {
    /// The account GitHub is read as.
    case account
    case organization
    /// Someone else, whose repository the account collaborates on.
    case other
  }

  public var owner: String
  public var kind: Kind
  /// Most recently pushed first, as GitHub lists them.
  public var repositories: [RepositoryAccess]

  public var id: String { owner.lowercased() }
}

/// The suggestions grouped by owner, as the picker lists them: the account
/// first, then its organizations in GitHub's order, then other owners by
/// name. Only those whose `owner/name` contains every word of `text` are
/// kept, or, when `text` names a repository, those whose address contains
/// it, so that a pasted URL finds its repository.
public func groupSuggestions(
  _ repositories: [RepositoryAccess], account: String, organizations: [String], matching text: String = ""
) -> [SuggestionGroup] {
  let words: [String] =
    if let typed = RepositoryAddress.fromInput(text) {
      [typed.description.lowercased()]
    } else {
      text.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
    }
  var groups: [String: SuggestionGroup] = [:]
  var order: [String] = []
  let organizationKeys = Set(organizations.map { $0.lowercased() })
  for repository in repositories {
    let address = repository.repository.description.lowercased()
    guard words.allSatisfy({ address.contains($0) }) else { continue }
    let owner = repository.repository.owner
    let key = owner.lowercased()
    if groups[key] == nil {
      let kind: SuggestionGroup.Kind =
        key == account.lowercased()
        ? .account
        : organizationKeys.contains(key) || repository.ownedByOrganization ? .organization : .other
      groups[key] = SuggestionGroup(owner: owner, kind: kind, repositories: [])
      order.append(key)
    }
    groups[key]?.repositories.append(repository)
  }
  let organizationRank = Dictionary(
    organizations.enumerated().map { ($1.lowercased(), $0) }, uniquingKeysWith: { first, _ in first })
  return order.compactMap { groups[$0] }.sorted { a, b in
    func rank(_ group: SuggestionGroup) -> (Int, Int, String) {
      switch group.kind {
      case .account: (0, 0, "")
      case .organization: (1, organizationRank[group.id] ?? Int.max, group.id)
      case .other: (2, 0, group.id)
      }
    }
    return rank(a) < rank(b)
  }
}

extension RepositoryAccess {
  /// Why its issues cannot be tracked, if they cannot.
  public var unavailableReason: String? {
    if !hasIssuesEnabled { return "Issues are turned off for this repository." }
    if let issuesDenied { return issuesDenied.message }
    return nil
  }
}
