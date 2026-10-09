import Foundation

/// An issue a link to github.com names: `https://github.com/owner/name/issues/12`,
/// also with a query or fragment, such as a link to one of its comments.
/// GitHub renders references such as `#12` and `owner/name#12` as such
/// links too. Links in bodies that name one open its page in the app.
public struct IssueLink: Hashable, Sendable {
    public var repository: RepositoryAddress
    public var number: Int

    public init(repository: RepositoryAddress, number: Int) {
        self.repository = repository
        self.number = number
    }

    /// Reads a link, or `nil` if it names no issue on github.com.
    public init?(_ url: URL) {
        guard url.scheme?.lowercased() == "https", url.user() == nil, url.password() == nil,
            let host = url.host()?.lowercased(), host == "github.com" || host == "www.github.com"
        else { return nil }
        let parts = url.path(percentEncoded: false).split(separator: "/", omittingEmptySubsequences: false)
        // "", owner, name, "issues", number, and perhaps "" after a slash.
        guard parts.count == 5 || (parts.count == 6 && parts[5].isEmpty), parts[0].isEmpty, parts[3] == "issues",
            Self.isName(parts[1]), Self.isName(parts[2]),
            parts[4].allSatisfy(\.isASCII), parts[4].allSatisfy(\.isNumber), let number = Int(parts[4]), number > 0
        else { return nil }
        self.repository = RepositoryAddress(owner: String(parts[1]), name: String(parts[2]))
        self.number = number
    }

    /// An owner's or repository's name, as GitHub allows them in a path.
    private static func isName(_ part: Substring) -> Bool {
        !part.isEmpty && part.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || "-_.".contains($0)) }
    }

    /// `owner/name#12`.
    public var reference: String { "\(repository.nameWithOwner)#\(number)" }
}

/// Where a link in an issue's body or a comment leads, when it is tapped
/// (`link-target.ts` on the desktop):
///
/// - `issue`: a GitHub issue, which opens in the app, whether its repository
///   is tracked or not;
/// - `anchor`: an element in the same body, such as a footnote;
/// - `external`: any other `https://` address, which opens in the browser;
/// - `none`: anything else, which never opens.
public enum BodyLink: Hashable, Sendable {
    case issue(IssueLink)
    case anchor(String)
    case external(URL)
    case none

    /// Where a link leads, by its `href`, which the body's sanitizing made
    /// absolute unless it points within the body.
    public init(href: String) {
        let href = href.trimmingCharacters(in: .whitespacesAndNewlines)
        if href.hasPrefix("#") {
            let id = String(href.dropFirst())
            self = id.isEmpty ? .none : .anchor(id)
            return
        }
        guard let url = URL(string: href), url.scheme?.lowercased() == "https", url.host() != nil else {
            self = .none
            return
        }
        if let issue = IssueLink(url) {
            self = .issue(issue)
        } else {
            self = .external(url)
        }
    }

    /// Whether an address is on github.com, whose pages GitHub's own app
    /// opens where it is installed, and Safari with the user's session.
    public static func isOnGitHub(_ url: URL) -> Bool {
        guard let host = url.host()?.lowercased() else { return false }
        return host == "github.com" || host.hasSuffix(".github.com")
    }
}
