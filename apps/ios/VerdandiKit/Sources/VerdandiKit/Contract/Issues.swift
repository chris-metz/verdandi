import Foundation

// The contract's issues, lists, views and issue pages: see `Contract.swift`.

/// A GitHub label (the contract's `Label`).
public struct IssueLabel: Codable, Hashable, Sendable, Identifiable {
    public var name: String
    /// Six hex digits, without `#`.
    public var color: String

    public init(name: String, color: String) {
        self.name = name
        self.color = color
    }

    public var id: String { name.lowercased() }
}

public struct RelationshipCount: Decodable, Hashable, Sendable {
    public var open: Int
    public var total: Int
}

public struct SubIssueProgress: Decodable, Hashable, Sendable {
    public var closed: Int
    public var total: Int
}

public struct IssueActor: Decodable, Hashable, Sendable {
    public var login: String
    public var avatarUrl: String
}

/// An issue as a list or page shows it: what every issue has
/// (`IssueIdentity`), and, once it has been read, the rest of the
/// contract's `IssueSummary`. An unread issue lacks the rest.
public struct IssueInfo: Decodable, Hashable, Sendable, Identifiable {
    public var id: String
    public var repository: RepositoryAddress
    /// `#12`, or `owner/name#12` outside the list's repository.
    public var reference: String
    public var title: String
    public var state: IssueState
    public var url: String
    public var external: Bool

    public var author: IssueActor?
    public var createdAt: String?
    /// Only on a closed issue.
    public var closedAt: String?
    public var updatedAt: String?
    public var labels: [IssueLabel]?
    public var subIssueProgress: SubIssueProgress?
    public var blockedBy: RelationshipCount?
    public var blocking: RelationshipCount?
    public var incomplete: Problem?

    /// Only on an issue page's issue: its metadata.
    public var stateReason: StateReason?
    public var assignees: [IssueActor]?
    public var milestone: String?
    public var commentCount: Int?
    public var bodyHTML: String?

    /// The issue's number, from its reference.
    public var number: Int? {
        reference.split(separator: "#").last.flatMap { Int($0) }
    }

    /// `owner/name#12`, whatever the list calls it.
    public var qualifiedReference: String {
        "\(repository.nameWithOwner)#\(number.map(String.init) ?? "")"
    }

    /// When it was opened.
    public var created: Date? {
        createdAt.flatMap { try? Date($0, strategy: .iso8601) }
    }

    /// When it was last closed, unless it is open.
    public var closed: Date? {
        closedAt.flatMap { try? Date($0, strategy: .iso8601) }
    }

    /// When GitHub last recorded a change to it.
    public var updated: Date? {
        updatedAt.flatMap { try? Date($0, strategy: .iso8601) }
    }
}

public enum StateReason: String, Decodable, Hashable, Sendable {
    case completed
    case notPlanned = "not-planned"
    case reopened
    case duplicate
}

/// Why an issue a relationship names has not been read.
public enum UnreadIssue: Decodable, Hashable, Sendable {
    case loading
    case failed(Problem)

    private enum CodingKeys: String, CodingKey { case status, problem }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.status) {
        case "loading": self = .loading
        case "failed": self = .failed(try c.decode(Problem.self, forKey: .problem))
        case let tag: throw c.unknownTag(tag, .status)
        }
    }
}

/// How a view, or a list a label filter narrows, shows an issue.
public struct MatchMark: Decodable, Hashable, Sendable {
    public var match: Bool
    public var mayMatch: Bool
    public var matchesInside: Int
}

/// A parent issue a list names instead of showing it above.
public struct ParentIssue: Decodable, Hashable, Sendable {
    public var id: String
    public var reference: String
    public var title: String
    public var external: Bool
    public var unread: UnreadIssue?
    /// Only in an issue page's ancestry.
    public var url: String?
}

/// An issue in a list or on a page, with its sub-issues below it. The
/// contract's `IssueNode`, `IssueTree` and `ViewTree` in one: `parent` only
/// at a list's top level, `missingParent` only in a view's.
public struct IssueNode: Decodable, Hashable, Sendable, Identifiable {
    public var issue: IssueInfo
    public var subIssues: [IssueNode]
    public var expanded: Bool
    /// Why it has not been read, unless it has.
    public var unread: UnreadIssue?
    public var mark: MatchMark?
    public var parent: ParentIssue?
    public var missingParent: UnreadIssue?

    public var id: String { issue.id }
}

/// How far a part of a screen has loaded, and how current it is.
public enum LoadingState: Decodable, Hashable, Sendable {
    case loading
    case refreshing(updatedAt: Double)
    case current(updatedAt: Double)
    case stale(updatedAt: Double, problem: Problem)
    case failed(Problem)
    /// Only for comments: some could not be read.
    case partial(updatedAt: Double, problem: Problem)

    private enum CodingKeys: String, CodingKey { case status, updatedAt, problem }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.status) {
        case "loading": self = .loading
        case "refreshing": self = .refreshing(updatedAt: try c.decode(Double.self, forKey: .updatedAt))
        case "current": self = .current(updatedAt: try c.decode(Double.self, forKey: .updatedAt))
        case "stale":
            self = .stale(
                updatedAt: try c.decode(Double.self, forKey: .updatedAt),
                problem: try c.decode(Problem.self, forKey: .problem))
        case "partial":
            self = .partial(
                updatedAt: try c.decode(Double.self, forKey: .updatedAt),
                problem: try c.decode(Problem.self, forKey: .problem))
        case "failed": self = .failed(try c.decode(Problem.self, forKey: .problem))
        case let tag: throw c.unknownTag(tag, .status)
        }
    }

    public var isLoading: Bool { self == .loading }
    public var isBusy: Bool {
        switch self {
        case .loading, .refreshing: true
        default: false
        }
    }
    /// What could not be read, if anything.
    public var problem: Problem? {
        switch self {
        case .stale(_, let problem), .failed(let problem), .partial(_, let problem): problem
        default: nil
        }
    }
    public var updatedAt: Date? {
        switch self {
        case .refreshing(let at), .current(let at), .stale(let at, _), .partial(let at, _):
            Date(timeIntervalSince1970: at / 1000)
        default: nil
        }
    }
}

public struct RepositoryLoading: Decodable, Hashable, Sendable {
    public var repository: RepositoryAddress
    public var loading: LoadingState
}

/// How far a list has loaded, with its counts once its matches have.
public struct ListLoading: Decodable, Hashable, Sendable {
    public var state: LoadingState
    public var progress: ListProgress?
    public var counts: ListCounts?

    public struct ListProgress: Decodable, Hashable, Sendable {
        public var read: Int
        public var total: Int?
    }

    public struct ListCounts: Decodable, Hashable, Sendable {
        public var matches: Int
        public var inScope: Int
        public var closedNotListed: Int
    }

    private enum CodingKeys: String, CodingKey { case progress, matches }

    public init(from decoder: any Decoder) throws {
        state = try LoadingState(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        progress = try c.decodeIfPresent(ListProgress.self, forKey: .progress)
        counts = c.contains(.matches) ? try ListCounts(from: decoder) : nil
    }
}

/// A scope's list in its state, as far as it has loaded.
public struct IssueList: Decodable, Hashable, Sendable {
    public var scope: Scope
    public var state: IssueState
    public var sortOrder: ListSortOrder
    public var labelFilter: [IssueLabel]
    public var archived: Bool?
    public var trees: [IssueNode]
    public var loading: ListLoading
    public var repositories: [RepositoryLoading]
}

/// Why GitHub failed a view's search.
public enum SearchProblem: Decodable, Hashable, Sendable {
    case invalid(message: String)
    case unsearchable(message: String)
    case tooLarge

    private enum CodingKeys: String, CodingKey { case kind, message }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.kind) {
        case "invalid": self = .invalid(message: try c.decode(String.self, forKey: .message))
        case "unsearchable": self = .unsearchable(message: try c.decode(String.self, forKey: .message))
        case "too-large": self = .tooLarge
        case let tag: throw c.unknownTag(tag, .kind)
        }
    }

    public var message: String {
        switch self {
        case .invalid(let message), .unsearchable(let message): message
        case .tooLarge: "GitHub could not run this search, as it is too long."
        }
    }
}

/// A view's screen: the issues its search matches, under their ancestry.
public struct ViewList: Decodable, Hashable, Sendable {
    public var view: SavedView
    public var labelFilter: [IssueLabel]
    public var trees: [IssueNode]
    public var matchesShown: Int
    public var inScope: Int
    public var readingContext: Bool
    public var matchCount: Int?
    public var pullRequests: Int
    public var complete: Bool
    public var incomplete: Bool
    public var searching: Searching?
    public var searchProblem: SearchProblem?
    public var loading: LoadingState

    public struct Searching: Decodable, Hashable, Sendable {
        public var page: Int
        public var pages: Int?
    }
}

public struct IssueComment: Decodable, Hashable, Sendable, Identifiable {
    public var id: String
    public var author: IssueActor?
    public var createdAt: String
    public var url: String
    public var bodyHTML: String

    public var created: Date? { try? Date(createdAt, strategy: .iso8601) }
}

public struct IssueComments: Decodable, Hashable, Sendable {
    public var comments: [IssueComment]
    public var loading: LoadingState
}

public enum BlockingSide: String, Codable, Hashable, Sendable, CaseIterable {
    case blockedBy, blocking
}

public enum BlockingBadge: Decodable, Hashable, Sendable {
    case unloaded(count: Int)
    case closed
    case loading
    case paused
    case failed(Problem)
    case inaccessible(count: Int)

    private enum CodingKeys: String, CodingKey { case kind, count, problem }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.kind) {
        case "unloaded": self = .unloaded(count: try c.decode(Int.self, forKey: .count))
        case "closed": self = .closed
        case "loading": self = .loading
        case "paused": self = .paused
        case "failed": self = .failed(try c.decode(Problem.self, forKey: .problem))
        case "inaccessible": self = .inaccessible(count: try c.decode(Int.self, forKey: .count))
        case let tag: throw c.unknownTag(tag, .kind)
        }
    }
}

public enum BlockingEnd: Decodable, Hashable, Sendable {
    case none
    case unknown
    case folded(count: Int)
    case expanded
    case loading(count: Int)
    case paused

    private enum CodingKeys: String, CodingKey { case kind, count }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.kind) {
        case "none": self = .none
        case "unknown": self = .unknown
        case "folded": self = .folded(count: try c.decode(Int.self, forKey: .count))
        case "expanded": self = .expanded
        case "loading": self = .loading(count: try c.decode(Int.self, forKey: .count))
        case "paused": self = .paused
        case let tag: throw c.unknownTag(tag, .kind)
        }
    }
}

/// The blocking map: cards by signed step, blockers on the negative side.
public struct BlockingMap: Decodable, Hashable, Sendable {
    public var cards: [Card]
    /// Arrows point from the blocker to the issue that waits.
    public var edges: [Edge]
    public var ends: Ends
    public var problems: [Problem]

    public struct Card: Decodable, Hashable, Sendable, Identifiable {
        public var issue: IssueInfo
        public var step: Int
        public var badges: Badges
        public var id: String { issue.id }
    }

    public struct Badges: Decodable, Hashable, Sendable {
        public var blockedBy: BlockingBadge?
        public var blocking: BlockingBadge?

        public subscript(side: BlockingSide) -> BlockingBadge? {
            side == .blockedBy ? blockedBy : blocking
        }
    }

    public struct Edge: Decodable, Hashable, Sendable {
        public var from: String
        public var to: String
        public var cycle: Bool
        public var closed: Bool
    }

    public struct Ends: Decodable, Hashable, Sendable {
        public var blockedBy: BlockingEnd
        public var blocking: BlockingEnd

        public subscript(side: BlockingSide) -> BlockingEnd {
            side == .blockedBy ? blockedBy : blocking
        }
    }
}

/// An issue page, including relationships outside tracked repositories.
public struct IssuePage: Decodable, Hashable, Sendable {
    public var issueId: String
    /// The issue with its metadata, once it has been read.
    public var issue: IssueInfo?
    /// Top-most parent first, without the issue itself.
    public var ancestry: [ParentIssue]
    public var subIssues: [IssueNode]
    public var blockingMap: BlockingMap?
    public var comments: IssueComments?
    public var loading: LoadingState
}

public enum RenewedMediaLinks: Decodable, Hashable, Sendable {
    case renewed(bodyHTML: String)
    case failed(Problem)

    private enum CodingKeys: String, CodingKey { case status, bodyHTML, problem }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.status) {
        case "renewed": self = .renewed(bodyHTML: try c.decode(String.self, forKey: .bodyHTML))
        case "failed": self = .failed(try c.decode(Problem.self, forKey: .problem))
        case let tag: throw c.unknownTag(tag, .status)
        }
    }
}

/// What became of looking up an issue by its repository and number.
public enum IssueLookup: Decodable, Hashable, Sendable {
    case found(FoundIssue)
    case pullRequest(url: String)
    case failed(Problem)

    public struct FoundIssue: Decodable, Hashable, Sendable {
        public var id: String
        public var reference: String
        public var title: String
        public var url: String
    }

    private enum CodingKeys: String, CodingKey { case status, issue, url, problem }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.status) {
        case "found": self = .found(try c.decode(FoundIssue.self, forKey: .issue))
        case "pull-request": self = .pullRequest(url: try c.decode(String.self, forKey: .url))
        case "failed": self = .failed(try c.decode(Problem.self, forKey: .problem))
        case let tag: throw c.unknownTag(tag, .status)
        }
    }
}

// MARK: - Repository picker

public struct PickerOwner: Decodable, Hashable, Sendable {
    public enum Kind: String, Decodable, Sendable { case account, organization }
    public var login: String
    public var kind: Kind
}

public struct PickerRepository: Decodable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var repository: RepositoryAddress
    public var archived: Bool
    public var tracked: Bool
    public var unavailable: RepositoryUnavailable?
}

public enum RepositoryUnavailable: Decodable, Hashable, Sendable {
    case issuesDisabled
    case noIssueAccess(access: AccessEvidence?)

    private enum CodingKeys: String, CodingKey { case kind, access }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.kind) {
        case "issues-disabled": self = .issuesDisabled
        case "no-issue-access": self = .noIssueAccess(access: try c.decodeIfPresent(AccessEvidence.self, forKey: .access))
        case let tag: throw c.unknownTag(tag, .kind)
        }
    }

    public var message: String {
        switch self {
        case .issuesDisabled: "Its issues are turned off."
        case .noIssueAccess(let access):
            access?.message ?? "GitHub does not let this account read its issues."
        }
    }
}

public enum SuggestionsLoading: Decodable, Hashable, Sendable {
    case loading
    case loaded(capped: Bool)
    case failed(Problem)

    private enum CodingKeys: String, CodingKey { case status, capped, problem }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.status) {
        case "loading": self = .loading
        case "loaded": self = .loaded(capped: try c.decode(Bool.self, forKey: .capped))
        case "failed": self = .failed(try c.decode(Problem.self, forKey: .problem))
        case let tag: throw c.unknownTag(tag, .status)
        }
    }
}

public struct RepositorySuggestions: Decodable, Hashable, Sendable {
    public var owners: [PickerOwner]
    public var repositories: [PickerRepository]
    public var loading: SuggestionsLoading
    public var restrictions: [AccessEvidence]
    public var incomplete: Bool
}

public enum RepositoryCheck: Decodable, Hashable, Sendable {
    case found(PickerRepository)
    case failed(Problem)

    private enum CodingKeys: String, CodingKey { case status, repository, problem }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.status) {
        case "found": self = .found(try c.decode(PickerRepository.self, forKey: .repository))
        case "failed": self = .failed(try c.decode(Problem.self, forKey: .problem))
        case let tag: throw c.unknownTag(tag, .status)
        }
    }
}

public struct RepositoryAddition: Decodable, Hashable, Sendable {
    public enum Outcome: Hashable, Sendable {
        case added(PickerRepository)
        case unavailable(PickerRepository)
        case failed(Problem)
    }

    public var asked: RepositoryAddress
    public var outcome: Outcome

    private enum CodingKeys: String, CodingKey { case asked, status, repository, problem }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        asked = try c.decode(RepositoryAddress.self, forKey: .asked)
        switch try c.tag(.status) {
        case "added": outcome = .added(try c.decode(PickerRepository.self, forKey: .repository))
        case "unavailable": outcome = .unavailable(try c.decode(PickerRepository.self, forKey: .repository))
        case "failed": outcome = .failed(try c.decode(Problem.self, forKey: .problem))
        case let tag: throw c.unknownTag(tag, .status)
        }
    }
}
