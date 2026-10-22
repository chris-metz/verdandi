import Foundation

// The contract between the core and every interface, as Swift reads it:
// the types of `packages/core/src/contract.ts`, under the same names, which
// the core sends as JSON. A value TypeScript leaves `undefined` is missing
// from that JSON, so it is optional here. Unions are enums, told apart by
// the field the core tells them apart by (`kind` or `status`); a value of it
// the contract does not have fails to decode, rather than pass for another
// case, so that `ContractTests` catches the two drifting apart.
//
// `Label` is `IssueLabel` here, as SwiftUI has a `Label` of its own.

extension KeyedDecodingContainer {
    /// Reads the field a union is told apart by.
    func tag(_ key: Key) throws -> String { try decode(String.self, forKey: key) }

    /// The error for a union's tag the contract does not have.
    func unknownTag(_ tag: String, _ key: Key) -> DecodingError {
        DecodingError.dataCorruptedError(
            forKey: key, in: self, debugDescription: "The contract has no \(key.stringValue) \"\(tag)\".")
    }
}

// MARK: - Accounts and setup

public struct Account: Codable, Hashable, Sendable {
    public var login: String
    public var host: String
}

/// Where the token comes from: the Keychain (`stored`), or an environment
/// variable the app was launched with. Only the source is ever named.
public enum TokenSource: String, Codable, Hashable, Sendable {
    case stored
    case ghToken = "GH_TOKEN"
    case githubToken = "GITHUB_TOKEN"
}

public enum AccountStatus: Decodable, Hashable, Sendable {
    case known(account: Account, tokenSource: TokenSource)
    /// The token could not be checked, e.g. without a connection.
    case unconfirmed(message: String)

    private enum CodingKeys: String, CodingKey { case status, account, tokenSource, message }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.status) {
        case "known":
            self = .known(
                account: try c.decode(Account.self, forKey: .account),
                tokenSource: try c.decode(TokenSource.self, forKey: .tokenSource))
        case "unconfirmed":
            self = .unconfirmed(message: try c.decode(String.self, forKey: .message))
        case let tag: throw c.unknownTag(tag, .status)
        }
    }
}

public struct GhExecutable: Decodable, Hashable, Sendable {
    public var path: String
    public var version: String
}

public struct UnusableGh: Decodable, Hashable, Sendable {
    public var path: String
    public var reason: String
}

/// Whether Verdandi can read GitHub. On iOS, "gh" is the app's own
/// stand-in, so `blocked` means it has no token, or GitHub rejected it.
public enum Setup: Decodable, Hashable, Sendable {
    case checking
    case ready(account: AccountStatus)
    case blocked(SetupProblem)

    private enum CodingKeys: String, CodingKey { case status, account, problem }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.status) {
        case "checking": self = .checking
        case "ready": self = .ready(account: try c.decode(AccountStatus.self, forKey: .account))
        case "blocked": self = .blocked(try c.decode(SetupProblem.self, forKey: .problem))
        case let tag: throw c.unknownTag(tag, .status)
        }
    }

    /// The account GitHub is read as, once it is known.
    public var account: Account? {
        if case .ready(.known(let account, _)) = self { return account }
        return nil
    }
}

public enum SetupProblem: Decodable, Hashable, Sendable {
    case noUsableGh(notUsable: [UnusableGh])
    case signedOut
    case credentialsRejected(login: String?, tokenSource: TokenSource)

    private enum CodingKeys: String, CodingKey { case kind, notUsable, login, tokenSource }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.kind) {
        case "no-usable-gh": self = .noUsableGh(notUsable: try c.decode([UnusableGh].self, forKey: .notUsable))
        case "signed-out": self = .signedOut
        case "credentials-rejected":
            self = .credentialsRejected(
                login: try c.decodeIfPresent(String.self, forKey: .login),
                tokenSource: try c.decode(TokenSource.self, forKey: .tokenSource))
        case let tag: throw c.unknownTag(tag, .kind)
        }
    }
}

/// Something the user is told briefly, as it happens.
public enum Notice: Decodable, Hashable, Sendable {
    case ghReplaced(previous: String)
    case accountChanged(previous: Account, account: Account)
    case repositoriesRenamed([RepositoryRename])
    case duplicateRepositoriesRemoved([RemovedDuplicate])

    public struct RemovedDuplicate: Decodable, Hashable, Sendable {
        public var repository: RepositoryAddress
        public var sameAs: RepositoryAddress
    }

    private enum CodingKeys: String, CodingKey { case kind, previous, account, renamed, removed }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.kind) {
        case "gh-replaced": self = .ghReplaced(previous: try c.decode(String.self, forKey: .previous))
        case "account-changed":
            self = .accountChanged(
                previous: try c.decode(Account.self, forKey: .previous),
                account: try c.decode(Account.self, forKey: .account))
        case "repositories-renamed":
            self = .repositoriesRenamed(try c.decode([RepositoryRename].self, forKey: .renamed))
        case "duplicate-repositories-removed":
            self = .duplicateRepositoriesRemoved(try c.decode([RemovedDuplicate].self, forKey: .removed))
        case let tag: throw c.unknownTag(tag, .kind)
        }
    }
}

public struct RepositoryRename: Decodable, Hashable, Sendable {
    public var from: RepositoryAddress
    public var to: RepositoryAddress
    public var views: [SavedView]
}

/// Why GitHub would not let this account read something, when it says so.
public enum AccessEvidence: Decodable, Hashable, Sendable {
    case sso(message: String, url: String?)
    case organizationApproval(message: String)

    private enum CodingKeys: String, CodingKey { case kind, message, url }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let message = try c.decode(String.self, forKey: .message)
        switch try c.tag(.kind) {
        case "sso": self = .sso(message: message, url: try c.decodeIfPresent(String.self, forKey: .url))
        case "organization-approval": self = .organizationApproval(message: message)
        case let tag: throw c.unknownTag(tag, .kind)
        }
    }

    public var message: String {
        switch self {
        case .sso(let message, _), .organizationApproval(let message): message
        }
    }
}

// MARK: - Rate limits

public enum RateLimitPool: String, Codable, Hashable, Sendable {
    case graphql, core, search
}

public struct RateLimitState: Decodable, Hashable, Sendable {
    public enum Status: String, Decodable, Sendable { case paused, low }
    public var pool: RateLimitPool
    public var status: Status
    /// In milliseconds since the epoch.
    public var until: Double
}

public struct RateLimitBudget: Decodable, Hashable, Sendable {
    public var pool: RateLimitPool
    public var limit: Int
    public var remaining: Int
    /// In milliseconds since the epoch.
    public var resetAt: Double
}

// MARK: - Problems

/// Why something could not be read.
public enum Problem: Decodable, Hashable, Sendable {
    /// GitHub could not be reached, e.g. without a connection.
    case unreachable(message: String)
    /// GitHub would not show it to this account.
    case unavailable(access: AccessEvidence?, issuesDisabled: Bool, nameTakenOver: Bool)
    /// It was not read, as its screen was left.
    case interrupted
    case error(message: String)

    private enum CodingKeys: String, CodingKey { case kind, message, access, issuesDisabled, nameTakenOver }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.kind) {
        case "unreachable": self = .unreachable(message: try c.decode(String.self, forKey: .message))
        case "unavailable":
            self = .unavailable(
                access: try c.decodeIfPresent(AccessEvidence.self, forKey: .access),
                issuesDisabled: try c.decodeIfPresent(Bool.self, forKey: .issuesDisabled) ?? false,
                nameTakenOver: try c.decodeIfPresent(Bool.self, forKey: .nameTakenOver) ?? false)
        case "interrupted": self = .interrupted
        case "error": self = .error(message: try c.decode(String.self, forKey: .message))
        case let tag: throw c.unknownTag(tag, .kind)
        }
    }

    /// A sentence for the user.
    public var message: String {
        switch self {
        case .unreachable(let message):
            "GitHub could not be reached. \(message)"
        case .unavailable(let access, let issuesDisabled, let nameTakenOver):
            if let access { access.message }
            else if issuesDisabled { "Its issues are turned off." }
            else if nameTakenOver { "Its name now belongs to another repository." }
            else { "GitHub does not show it to this account. It may not exist, or this account may not read it." }
        case .interrupted:
            "It was not read, since nothing on screen needed it any more."
        case .error(let message):
            message
        }
    }
}

// MARK: - Repositories and sidebar

public struct RepositoryAddress: Codable, Hashable, Sendable, Comparable {
    public var owner: String
    public var name: String

    public init(owner: String, name: String) {
        self.owner = owner
        self.name = name
    }

    /// `owner/name`.
    public var nameWithOwner: String { "\(owner)/\(name)" }

    /// Reads `owner/name`, or a link to the repository on github.com.
    public init?(parsing text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        var parts: [String]
        if let url = URL(string: trimmed), let host = url.host()?.lowercased(),
            host == "github.com" || host == "www.github.com"
        {
            parts = Array(url.path().split(separator: "/").map(String.init).prefix(2))
            if let last = parts.last, last.hasSuffix(".git") { parts[parts.count - 1] = String(last.dropLast(4)) }
        } else {
            parts = trimmed.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))
        guard parts.count == 2,
            parts.allSatisfy({ !$0.isEmpty && $0.unicodeScalars.allSatisfy(allowed.contains) })
        else { return nil }
        self.init(owner: parts[0], name: parts[1])
    }

    public static func < (a: Self, b: Self) -> Bool {
        a.nameWithOwner.localizedCaseInsensitiveCompare(b.nameWithOwner) == .orderedAscending
    }

    /// The same repository, whatever the case of its address.
    public func sameRepository(as other: RepositoryAddress) -> Bool {
        owner.lowercased() == other.owner.lowercased() && name.lowercased() == other.name.lowercased()
    }
}

/// A stored repository, with its GitHub ID once verified.
public struct TrackedRepository: Codable, Hashable, Sendable {
    public var owner: String
    public var name: String
    public var id: Int?

    public var address: RepositoryAddress { RepositoryAddress(owner: owner, name: name) }
}

public enum SidebarEntries: Decodable, Hashable, Sendable {
    case read(Read)
    case failed(message: String)

    public struct Read: Decodable, Hashable, Sendable {
        public var all: AllEntry
        public var repositories: [RepositoryEntry]
        public var views: [ViewEntry]
        public var settings: SettingsStatus
        public var firstLaunch: Bool
    }

    private enum CodingKeys: String, CodingKey { case status, message }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.status) {
        case "read": self = .read(try Read(from: decoder))
        case "failed": self = .failed(message: try c.decode(String.self, forKey: .message))
        case let tag: throw c.unknownTag(tag, .status)
        }
    }
}

public enum SettingsStatus: Decodable, Hashable, Sendable {
    case writable
    case invalid(message: String)
    case newerVersion(message: String)

    private enum CodingKeys: String, CodingKey { case status, message }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.status) {
        case "writable": self = .writable
        case "invalid": self = .invalid(message: try c.decode(String.self, forKey: .message))
        case "newer-version": self = .newerVersion(message: try c.decode(String.self, forKey: .message))
        case let tag: throw c.unknownTag(tag, .status)
        }
    }

    public var isWritable: Bool { self == .writable }
}

public struct AllEntry: Decodable, Hashable, Sendable {
    public var openIssues: OpenIssueCount
}

public struct RepositoryEntry: Decodable, Hashable, Sendable {
    public var repository: TrackedRepository
    public var openIssues: OpenIssueCount
    public var unavailable: Problem?
    public var archived: Bool?
}

public enum OpenIssueCount: Decodable, Hashable, Sendable {
    case loading
    case known(Int)
    case failed(message: String)

    private enum CodingKeys: String, CodingKey { case status, count, message }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.status) {
        case "loading": self = .loading
        case "known": self = .known(try c.decode(Int.self, forKey: .count))
        case "failed": self = .failed(message: try c.decode(String.self, forKey: .message))
        case let tag: throw c.unknownTag(tag, .status)
        }
    }

    public var count: Int? {
        if case .known(let count) = self { return count }
        return nil
    }
}

// MARK: - Look

public enum Appearance: String, Codable, Hashable, Sendable, CaseIterable {
    case system, light, dark
}

/// How Verdandi looks, and which optional features are on and how they
/// are set, as `config.toml` sets it.
public struct Config: Codable, Hashable, Sendable {
    public var appearance: Appearance
    public var lightTheme: String
    public var darkTheme: String
    public var interfaceFont: String?
    public var codeFont: String?
    public var textSize: Int
    /// Whether Checkouts is on, which needs git: iOS never shows it.
    public var checkouts: Bool
    /// The names of the main branches, which Checkouts brings up to date.
    public var mainBranches: [String]
}

// MARK: - Checkouts

/// Whether Checkouts is on. It reads git checkouts, here and over ssh,
/// which iOS cannot run, so the core never has it on here: the app reads
/// only whether it is, and none of what it shows on the desktop.
public enum Checkouts: Decodable, Hashable, Sendable {
    case off, unavailable, on

    private enum CodingKeys: String, CodingKey { case status }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.status) {
        case "off": self = .off
        case "unavailable": self = .unavailable
        case "on": self = .on
        case let tag: throw c.unknownTag(tag, .status)
        }
    }
}

/// A change to `config.toml`: only the keys given are written. A font set
/// to `.some(nil)` goes back to its default.
public struct ConfigChange: Encodable, Sendable {
    public var appearance: Appearance?
    public var lightTheme: String?
    public var darkTheme: String?
    public var interfaceFont: String??
    public var codeFont: String??
    public var textSize: Int?

    public init(
        appearance: Appearance? = nil, lightTheme: String? = nil, darkTheme: String? = nil,
        interfaceFont: String?? = nil, codeFont: String?? = nil, textSize: Int? = nil
    ) {
        self.appearance = appearance
        self.lightTheme = lightTheme
        self.darkTheme = darkTheme
        self.interfaceFont = interfaceFont
        self.codeFont = codeFont
        self.textSize = textSize
    }

    private enum CodingKeys: String, CodingKey {
        case appearance, lightTheme, darkTheme, interfaceFont, codeFont, textSize
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(appearance, forKey: .appearance)
        try c.encodeIfPresent(lightTheme, forKey: .lightTheme)
        try c.encodeIfPresent(darkTheme, forKey: .darkTheme)
        if let interfaceFont { try c.encode(interfaceFont, forKey: .interfaceFont) }
        if let codeFont { try c.encode(codeFont, forKey: .codeFont) }
        try c.encodeIfPresent(textSize, forKey: .textSize)
    }
}

public struct ConfigState: Decodable, Hashable, Sendable {
    public enum Status: String, Decodable, Sendable { case missing, read, unreadable }
    public var config: Config
    public var file: String
    public var status: Status
    public var problems: [ConfigProblem]
}

public struct ConfigProblem: Decodable, Hashable, Sendable {
    public var key: String?
    public var line: Int?
    public var message: String
    public var missingFont: String?
}

/// Whether a change was written, and why not.
public struct ChangeResult: Decodable, Hashable, Sendable {
    public var ok: Bool
    public var message: String?
}

// MARK: - Views

public struct SavedView: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var query: String
}

public struct ViewEntry: Decodable, Hashable, Sendable {
    public var view: SavedView
    public var matches: ViewMatchCount
}

public enum ViewMatchCount: Decodable, Hashable, Sendable {
    case unknown
    case known(Int)
    case rejected(message: String)

    private enum CodingKeys: String, CodingKey { case status, count, message }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.status) {
        case "unknown": self = .unknown
        case "known": self = .known(try c.decode(Int.self, forKey: .count))
        case "rejected": self = .rejected(message: try c.decode(String.self, forKey: .message))
        case let tag: throw c.unknownTag(tag, .status)
        }
    }
}

/// A view's name and search as the user entered them, to save.
public struct ViewDraft: Encodable, Hashable, Sendable {
    public var id: String?
    public var name: String
    public var query: String
    public var after: String?

    public init(id: String? = nil, name: String, query: String, after: String? = nil) {
        self.id = id
        self.name = name
        self.query = query
        self.after = after
    }
}

public enum ViewSave: Decodable, Hashable, Sendable {
    case saved(SavedView)
    case rejected(message: String)
    case unchecked(Problem)
    case failed(message: String)

    private enum CodingKeys: String, CodingKey { case status, view, message, problem }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.status) {
        case "saved": self = .saved(try c.decode(SavedView.self, forKey: .view))
        case "rejected": self = .rejected(message: try c.decode(String.self, forKey: .message))
        case "unchecked": self = .unchecked(try c.decode(Problem.self, forKey: .problem))
        case "failed": self = .failed(message: try c.decode(String.self, forKey: .message))
        case let tag: throw c.unknownTag(tag, .status)
        }
    }
}

/// A sidebar entry that can move: All is fixed.
public enum SidebarEntryKey: Codable, Hashable, Sendable {
    case repository(RepositoryAddress)
    case view(id: String)

    private enum CodingKeys: String, CodingKey { case kind, repository, id }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.kind) {
        case "repository": self = .repository(try c.decode(RepositoryAddress.self, forKey: .repository))
        case "view": self = .view(id: try c.decode(String.self, forKey: .id))
        case let tag: throw c.unknownTag(tag, .kind)
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .repository(let repository):
            try c.encode("repository", forKey: .kind)
            try c.encode(repository, forKey: .repository)
        case .view(let id):
            try c.encode("view", forKey: .kind)
            try c.encode(id, forKey: .id)
        }
    }
}

/// A move relative to the latest file.
public enum SidebarDestination: Encodable, Hashable, Sendable {
    case up, down
    case relative(to: SidebarEntryKey, before: Bool)

    private enum CodingKeys: String, CodingKey { case direction, relativeTo, side }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .up: try c.encode("up", forKey: .direction)
        case .down: try c.encode("down", forKey: .direction)
        case .relative(let key, let before):
            try c.encode(key, forKey: .relativeTo)
            try c.encode(before ? "before" : "after", forKey: .side)
        }
    }
}

// MARK: - Scopes and screens

/// What a list shows: All, or one tracked repository.
public enum Scope: Codable, Hashable, Sendable {
    case all
    case repository(RepositoryAddress)

    private enum CodingKeys: String, CodingKey { case kind, repository }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.kind) {
        case "all": self = .all
        case "repository": self = .repository(try c.decode(RepositoryAddress.self, forKey: .repository))
        case let tag: throw c.unknownTag(tag, .kind)
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .all: try c.encode("all", forKey: .kind)
        case .repository(let repository):
            try c.encode("repository", forKey: .kind)
            try c.encode(repository, forKey: .repository)
        }
    }
}

public enum IssueState: String, Codable, Hashable, Sendable {
    case open, closed
}

/// How a scope's list orders its trees, in both its states: Newest (in a
/// closed list, Recently closed) or Recently updated (the contract's
/// `SortOrder`, a name Foundation has).
public enum ListSortOrder: String, Codable, Hashable, Sendable, CaseIterable {
    case newest, updated
}

/// A list whose issues expand and collapse: a scope's, or a view's.
public enum ExpandableList: Encodable, Hashable, Sendable {
    case scope(Scope)
    case view(id: String)

    public func encode(to encoder: any Encoder) throws {
        switch self {
        case .scope(let scope): try scope.encode(to: encoder)
        case .view(let id):
            var c = encoder.container(keyedBy: ViewKeys.self)
            try c.encode("view", forKey: .kind)
            try c.encode(id, forKey: .viewId)
        }
    }

    private enum ViewKeys: String, CodingKey { case kind, viewId }
}

/// What the main area shows: a scope's list, a view, an issue page, or
/// Checkouts.
public enum Screen: Encodable, Hashable, Sendable {
    case list(Scope)
    case view(id: String)
    case issue(id: String)
    case checkouts

    private enum CodingKeys: String, CodingKey { case kind, scope, viewId, issueId }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .list(let scope):
            try c.encode("list", forKey: .kind)
            try c.encode(scope, forKey: .scope)
        case .view(let id):
            try c.encode("view", forKey: .kind)
            try c.encode(id, forKey: .viewId)
        case .issue(let id):
            try c.encode("issue", forKey: .kind)
            try c.encode(id, forKey: .issueId)
        case .checkouts:
            try c.encode("checkouts", forKey: .kind)
        }
    }
}

// MARK: - Tabs and recent issues

/// An issue page as the place it was opened from named it.
public struct TabIssue: Codable, Hashable, Sendable {
    public var id: String
    public var reference: String
    public var title: String
    public var url: String?

    public init(id: String, reference: String, title: String, url: String?) {
        self.id = id
        self.reference = reference
        self.title = title
        self.url = url
    }
}

/// A tab's entry when it is saved: All, a repository, a view, or Checkouts.
public enum SavedEntry: Encodable, Hashable, Sendable {
    case all
    case repository(RepositoryAddress)
    case view(id: String)
    case checkouts

    private enum CodingKeys: String, CodingKey { case kind, repository, id }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .all: try c.encode("all", forKey: .kind)
        case .repository(let repository):
            try c.encode("repository", forKey: .kind)
            try c.encode(repository, forKey: .repository)
        case .view(let id):
            try c.encode("view", forKey: .kind)
            try c.encode(id, forKey: .id)
        case .checkouts: try c.encode("checkouts", forKey: .kind)
        }
    }
}

public struct SavedTab: Encodable, Hashable, Sendable {
    public var entry: SavedEntry
    public var issues: [TabIssue]

    public init(entry: SavedEntry, issues: [TabIssue]) {
        self.entry = entry
        self.issues = issues
    }

    private enum CodingKeys: String, CodingKey { case kind, entry, issues }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode("entry", forKey: .kind)
        try c.encode(entry, forKey: .entry)
        try c.encode(issues, forKey: .issues)
    }
}

public struct SavedTabs: Encodable, Hashable, Sendable {
    public var tabs: [SavedTab]
    public var shown: Int

    public init(tabs: [SavedTab], shown: Int) {
        self.tabs = tabs
        self.shown = shown
    }
}

/// A sidebar entry, with the current view text when it is a view: All, a
/// repository, a view, or Checkouts, which the core restores only where
/// Checkouts is on, never on iOS.
public enum SidebarSelection: Decodable, Hashable, Sendable {
    case all
    case repository(RepositoryAddress)
    case view(SavedView)
    case checkouts

    private enum CodingKeys: String, CodingKey { case kind, repository, view }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.kind) {
        case "all": self = .all
        case "repository": self = .repository(try c.decode(RepositoryAddress.self, forKey: .repository))
        case "view": self = .view(try c.decode(SavedView.self, forKey: .view))
        case "checkouts": self = .checkouts
        case let tag: throw c.unknownTag(tag, .kind)
        }
    }
}

public enum RestoredTab: Decodable, Hashable, Sendable {
    case entry(SidebarSelection, issues: [TabIssue])
    case new

    private enum CodingKeys: String, CodingKey { case kind, entry, issues }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.tag(.kind) {
        case "entry":
            self = .entry(
                try c.decode(SidebarSelection.self, forKey: .entry),
                issues: try c.decode([TabIssue].self, forKey: .issues))
        case "new": self = .new
        case let tag: throw c.unknownTag(tag, .kind)
        }
    }
}

public struct RestoredTabs: Decodable, Hashable, Sendable {
    public var tabs: [RestoredTab]
    public var shown: Int
}

public struct RecentIssue: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var repository: RepositoryAddress
    public var number: Int
    public var title: String

    public init(id: String, repository: RepositoryAddress, number: Int, title: String) {
        self.id = id
        self.repository = repository
        self.number = number
        self.title = title
    }

    /// `owner/name#12`.
    public var reference: String { "\(repository.nameWithOwner)#\(number)" }
}
