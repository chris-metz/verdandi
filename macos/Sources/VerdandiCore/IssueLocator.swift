import Foundation

/// An issue as the user types it to go to it: `owner/name#12`,
/// `owner/name 12`, a link to its page on GitHub, or just `#12` or `12`,
/// which name an issue of a repository the context gives.
public struct IssueLocator: Hashable, Sendable {
  /// The repository named, or `nil` for a bare number.
  public var repository: RepositoryAddress?
  public var number: Int

  public init(repository: RepositoryAddress?, number: Int) {
    self.repository = repository
    self.number = number
  }

  /// The largest number GitHub looks an issue up by: a 32-bit `Int`.
  static let largestNumber = Int(Int32.max)

  /// Reads what was typed, or `nil` if it names no issue. A link to a pull
  /// request reads as its number too: only GitHub can tell the two apart.
  public init?(parsing text: String) {
    let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let found: (String?, Substring)
    if let match = text.wholeMatch(of: /#?(\d+)/) {
      found = (nil, match.1)
    } else if let match = text.wholeMatch(of: /([^\s\/#]+\/[^\s\/#]+)\s*(?:#\s*|\s)(\d+)/) {
      found = (String(match.1), match.2)
    } else if let match = text.wholeMatch(
      of: /(?:https?:\/\/)?(?:www\.)?github\.com\/([^\s\/]+\/[^\s\/]+)\/(?:issues|pull)\/(\d+)(?:[\/?#]\S*)?/
        .ignoresCase())
    {
      found = (String(match.1), match.2)
    } else {
      return nil
    }
    guard let number = Int(found.1), (1...Self.largestNumber).contains(number) else { return nil }
    if let name = found.0 {
      guard let repository = RepositoryAddress(name) else { return nil }
      self.repository = repository
    } else {
      repository = nil
    }
    self.number = number
  }

  /// `owner/name#12`, or `#12` without a repository.
  public var description: String {
    repository.map { $0.reference(number) } ?? "#\(number)"
  }
}
