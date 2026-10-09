import Foundation
import VerdandiKit

/// How the app says why something could not be read: a short sentence, more
/// in GitHub's own words, and where to act on it, as the desktop's
/// `problem-text.ts` says it. What GitHub will not show is "unavailable or
/// not accessible", never deleted or missing a permission: a specific
/// reason, and a link, come only from GitHub's answer.
struct ReasonText: Equatable {
    var text: String
    /// More, in GitHub's own words.
    var detail: String?
    /// Where to act on it, only when GitHub gave the link, e.g. to authorize
    /// single sign-on.
    var link: URL?

    init(text: String, detail: String? = nil, link: URL? = nil) {
        self.text = text
        self.detail = detail
        self.link = link
    }

    /// What the app says of a problem. A tracked repository whose name
    /// another repository took over is named, when given.
    init(_ problem: Problem, login: String? = nil, repository: RepositoryAddress? = nil) {
        switch problem {
        case .unreachable(let message):
            self.init(text: "Cannot reach GitHub", detail: message)
        case .unavailable(let access, let issuesDisabled, let nameTakenOver):
            if nameTakenOver {
                let name = repository?.nameWithOwner ?? "Its name"
                self.init(
                    text:
                        "\(name) now names a different repository. The one you tracked is unavailable or not accessible with this account."
                )
                return
            }
            let account = login.map { " (@\($0))" } ?? ""
            self.init(
                text: "Unavailable or not accessible with this account\(account)",
                detail: issuesDisabled ? "Issues are turned off for this repository" : access?.message,
                link: Self.ssoLink(access))
        case .interrupted:
            self.init(text: "Loading was interrupted")
        case .error(let message):
            self.init(text: message)
        }
    }

    /// Why a repository cannot be added, as the picker says it.
    init(_ unavailable: RepositoryUnavailable) {
        switch unavailable {
        case .issuesDisabled:
            self.init(text: "Issues are turned off for this repository")
        case .noIssueAccess(let access):
            self.init(
                text: "Its issues are not accessible with this account", detail: access?.message,
                link: Self.ssoLink(access))
        }
    }

    /// The sentence and its detail together, for VoiceOver or a menu.
    var full: String {
        [text, detail].compactMap { $0 }.joined(separator: ". ")
    }

    /// The link GitHub gave to authorize the token for an organization's
    /// single sign-on, if it gave one.
    static func ssoLink(_ access: AccessEvidence?) -> URL? {
        if case .sso(_, let url?) = access { return URL(string: url) }
        return nil
    }
}

/// Pages on github.com the sidebar and its sheets open.
enum SidebarLinks {
    /// A repository's page.
    static func repository(_ repository: RepositoryAddress) -> URL? {
        var components = URLComponents()
        components.scheme = "https"
        components.host = "github.com"
        components.path = "/\(repository.owner)/\(repository.name)"
        return components.url
    }

    /// A view's search, as GitHub's own issue search runs it.
    static func search(_ view: SavedView) -> URL? {
        var components = URLComponents(string: "https://github.com/issues")
        components?.queryItems = [URLQueryItem(name: "q", value: view.query)]
        return components?.url
    }

    /// An account's or organization's picture, as github.com serves it.
    static func avatar(_ login: String, points: CGFloat) -> URL? {
        var components = URLComponents()
        components.scheme = "https"
        components.host = "github.com"
        components.path = "/\(login).png"
        components.queryItems = [URLQueryItem(name: "size", value: String(Int(points * 3)))]
        return components.url
    }
}
