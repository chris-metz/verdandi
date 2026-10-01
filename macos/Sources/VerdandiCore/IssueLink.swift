import Foundation

/// An issue a link to github.com names: `https://github.com/owner/name/issues/12`,
/// also with a fragment, such as a link to one of its comments. Links in
/// bodies and comments that name one open in the app.
public struct IssueLink: Hashable, Sendable {
  public var repository: RepositoryAddress
  public var number: Int

  public init(repository: RepositoryAddress, number: Int) {
    self.repository = repository
    self.number = number
  }

  /// Reads a link, or `nil` if it names no issue on github.com.
  public init?(_ url: URL) {
    guard url.scheme?.lowercased() == "https",
      let host = url.host()?.lowercased(), host == "github.com" || host == "www.github.com"
    else { return nil }
    let parts = url.path().split(separator: "/", omittingEmptySubsequences: true)
    guard parts.count == 4, parts[2] == "issues", let number = Int(parts[3]), number > 0,
      let repository = RepositoryAddress("\(parts[0])/\(parts[1])")
    else { return nil }
    self.repository = repository
    self.number = number
  }

  /// `owner/name#12`.
  public var reference: String { repository.reference(number) }
}
