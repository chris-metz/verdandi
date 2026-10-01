import Foundation

/// A repository by `owner/name`. GitHub compares names without case, and so
/// does this.
public struct RepositoryAddress: Hashable, Sendable, Codable, CustomStringConvertible {
  public var owner: String
  public var name: String

  public init(owner: String, name: String) {
    self.owner = owner
    self.name = name
  }

  /// Reads `owner/name`, or `nil` if it is not one.
  public init?(_ text: String) {
    let parts = text.trimmingCharacters(in: .whitespaces).split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count == 2, !parts[0].isEmpty, !parts[1].isEmpty,
      parts.allSatisfy({ $0.allSatisfy { $0.isLetter || $0.isNumber || "-_.".contains($0) } })
    else { return nil }
    owner = String(parts[0])
    name = String(parts[1])
  }

  public var description: String { "\(owner)/\(name)" }

  public static func == (a: Self, b: Self) -> Bool {
    a.owner.lowercased() == b.owner.lowercased() && a.name.lowercased() == b.name.lowercased()
  }

  public func hash(into hasher: inout Hasher) {
    hasher.combine(owner.lowercased())
    hasher.combine(name.lowercased())
  }

  /// `owner/name#12`.
  public func reference(_ number: Int) -> String { "\(self)#\(number)" }
}

public enum IssueState: String, Sendable, Hashable, Codable, CaseIterable {
  case open
  case closed

  /// Reads GitHub's `OPEN` or REST's `open`.
  public init?(github value: String) {
    self.init(rawValue: value.lowercased())
  }
}

public struct Label: Hashable, Sendable, Identifiable {
  public var name: String
  /// GitHub's colour, six hex digits without `#`.
  public var color: String

  public init(name: String, color: String) {
    self.name = name
    self.color = color
  }

  public var id: String { name }
}

/// An account as an issue or comment names it.
public struct Actor: Hashable, Sendable {
  public var login: String
  public var avatarURL: URL?

  public init(login: String, avatarURL: URL?) {
    self.login = login
    self.avatarURL = avatarURL
  }
}

/// Another issue as a relationship names it, without reading it.
public struct IssueReference: Hashable, Sendable, Identifiable {
  public var id: String
  public var repository: RepositoryAddress
  public var number: Int
  public var title: String
  public var state: IssueState

  public init(id: String, repository: RepositoryAddress, number: Int, title: String, state: IssueState) {
    self.id = id
    self.repository = repository
    self.number = number
    self.title = title
    self.state = state
  }

  public var qualifiedReference: String { repository.reference(number) }
}

/// An issue as a list reads it.
public struct Issue: Hashable, Sendable, Identifiable {
  /// GitHub's node ID.
  public var id: String
  public var repository: RepositoryAddress
  public var number: Int
  public var title: String
  public var state: IssueState
  public var url: URL
  /// Who opened it, unless their account has been deleted.
  public var author: Actor?
  public var createdAt: Date
  public var closedAt: Date?
  public var labels: [Label]
  public var parent: IssueReference?
  /// Its sub-issues in GitHub's order. Search results do not name them.
  public var subIssues: [IssueReference]
  /// Whether it has a parent issue, also when a search did not name it.
  public var hasParent: Bool
  public var subIssuesTotal: Int
  public var subIssuesCompleted: Int
  /// How many open issues block it.
  public var blockedBy: Int
  public var totalBlockedBy: Int
  /// How many open issues it blocks.
  public var blocking: Int
  public var totalBlocking: Int

  public init(
    id: String, repository: RepositoryAddress, number: Int, title: String, state: IssueState, url: URL,
    author: Actor?, createdAt: Date, closedAt: Date?, labels: [Label], parent: IssueReference?,
    subIssues: [IssueReference], hasParent: Bool, subIssuesTotal: Int, subIssuesCompleted: Int,
    blockedBy: Int, totalBlockedBy: Int, blocking: Int, totalBlocking: Int
  ) {
    self.id = id
    self.repository = repository
    self.number = number
    self.title = title
    self.state = state
    self.url = url
    self.author = author
    self.createdAt = createdAt
    self.closedAt = closedAt
    self.labels = labels
    self.parent = parent
    self.subIssues = subIssues
    self.hasParent = hasParent
    self.subIssuesTotal = subIssuesTotal
    self.subIssuesCompleted = subIssuesCompleted
    self.blockedBy = blockedBy
    self.totalBlockedBy = totalBlockedBy
    self.blocking = blocking
    self.totalBlocking = totalBlocking
  }

  public var reference: IssueReference {
    IssueReference(id: id, repository: repository, number: number, title: title, state: state)
  }

  public var qualifiedReference: String { repository.reference(number) }
}

/// Why an issue was closed, as GitHub says.
public enum StateReason: String, Sendable, Hashable {
  case completed = "COMPLETED"
  case notPlanned = "NOT_PLANNED"
  case duplicate = "DUPLICATE"
  case reopened = "REOPENED"
}

/// An issue with what its page shows besides the list's fields.
public struct IssueDetails: Sendable, Hashable, Identifiable {
  public var issue: Issue
  public var stateReason: StateReason?
  public var assignees: [Actor]
  public var milestone: String?
  public var commentCount: Int
  /// The body as GitHub renders it.
  public var bodyHTML: String

  public init(
    issue: Issue, stateReason: StateReason?, assignees: [Actor], milestone: String?, commentCount: Int,
    bodyHTML: String
  ) {
    self.issue = issue
    self.stateReason = stateReason
    self.assignees = assignees
    self.milestone = milestone
    self.commentCount = commentCount
    self.bodyHTML = bodyHTML
  }

  public var id: String { issue.id }
}

public struct IssueComment: Sendable, Hashable, Identifiable {
  public var id: String
  public var url: URL
  public var createdAt: Date
  public var bodyHTML: String
  public var author: Actor?

  public init(id: String, url: URL, createdAt: Date, bodyHTML: String, author: Actor?) {
    self.id = id
    self.url = url
    self.createdAt = createdAt
    self.bodyHTML = bodyHTML
    self.author = author
  }
}

/// The two sides of an issue's blocking relationships.
public enum BlockingSide: String, Sendable, Hashable, CaseIterable {
  /// The issues that block it.
  case blockedBy
  /// The issues it blocks.
  case blocking
}

/// A repository as the sidebar needs it, read without its issues.
public struct RepositorySummary: Sendable, Hashable {
  /// GitHub's numeric ID, which survives renames.
  public var id: Int
  /// Its current address, which differs from the one asked for once renamed.
  public var repository: RepositoryAddress
  public var openIssueCount: Int
  public var hasIssuesEnabled: Bool
  public var isArchived: Bool
}

/// A repository as the picker checks it: whether its issues can be read.
public struct RepositoryAccess: Sendable, Hashable, Identifiable {
  public var id: Int
  public var repository: RepositoryAddress
  public var ownedByOrganization: Bool
  public var hasIssuesEnabled: Bool
  public var isArchived: Bool
  /// Why GitHub refused this account the issues while showing the repository.
  public var issuesDenied: GitHubError?
}

public struct SuggestionPage: Sendable {
  /// The login of the account GitHub lists them for.
  public var account: String
  /// The account's organizations, on the first page only.
  public var organizations: [String]?
  public var repositories: [RepositoryAccess]
  public var nextPage: String?
}

public struct IssuePage: Sendable {
  public var issues: [Issue]
  /// How many closed issues the repository has.
  public var closedIssueCount: Int
  public var nextPage: String?
  /// Why GitHub left out issues of the page.
  public var incomplete: GitHubError?
}

public struct RelationshipPage: Sendable {
  public var issues: [Issue]
  /// How many issues the relationship has, including those of later pages.
  public var totalCount: Int
  public var nextPage: String?
  public var incomplete: GitHubError?
}

public struct CommentPage: Sendable {
  public var comments: [IssueComment]
  public var nextPage: String?
}

/// A page of an issue search: its issues, without pull requests.
public struct SearchPage: Sendable {
  /// How many issues and pull requests GitHub counts as matches.
  public var total: Int
  /// Whether GitHub says it did not search everything in time.
  public var incomplete: Bool
  public var issues: [Issue]
  public var pullRequests: Int
}

/// What a repository numbers so: an issue, or a pull request.
public enum NumberedItem: Sendable {
  case issue(IssueReference, url: URL)
  case pullRequest(url: URL)
}

public enum RateLimitPool: String, Sendable, Hashable, CaseIterable {
  case graphql
  case core
  case search
}

/// How much of a rate-limit pool's budget is left.
public struct RateLimitBudget: Sendable, Hashable {
  public var pool: RateLimitPool
  public var limit: Int
  public var remaining: Int
  public var resetAt: Date
}

/// Whether gh has working credentials for github.com.
public enum AuthStatus: Sendable, Hashable {
  case signedIn(login: String)
  case signedOut
  /// GitHub rejected them, e.g. an expired or revoked token.
  case rejected(login: String?, message: String)
}

public enum GitHubError: Error, Sendable, Hashable {
  /// There is no gh where it was found.
  case ghNotFound
  /// gh could not be started.
  case ghUnusable(String)
  /// gh has no credentials for github.com.
  case signedOut(String)
  /// gh exited without an HTTP response from GitHub, e.g. offline.
  case ghFailed(String)
  /// GitHub would not show it to this account, or it does not exist.
  case unavailable(String)
  /// A rate limit; `retryAfter` when GitHub says how long to wait.
  case rateLimited(String, retryAfter: TimeInterval?)
  /// GitHub failed to answer; asking again may succeed.
  case serverError(String)
  /// GitHub rejected a search, saying why.
  case invalidSearch(String)
  case http(status: Int, message: String)
  case graphql([String])
  case unexpectedResponse

  public var message: String {
    switch self {
    case .ghNotFound: "GitHub CLI (gh) was not found."
    case .ghUnusable(let message): message
    case .signedOut(let message): message
    case .ghFailed(let message): message
    case .unavailable(let message): message
    case .rateLimited(let message, _): message
    case .serverError(let message): message
    case .invalidSearch(let message): message
    case .http(_, let message): message
    case .graphql(let messages): messages.joined(separator: "\n")
    case .unexpectedResponse: "GitHub answered in an unexpected way."
    }
  }

  /// Whether the same request may succeed when asked again later.
  public var isTransient: Bool {
    switch self {
    case .ghFailed, .rateLimited, .serverError: true
    default: false
    }
  }
}
