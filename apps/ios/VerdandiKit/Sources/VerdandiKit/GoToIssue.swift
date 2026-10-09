import Foundation

// Go to Issue, as the desktop app reads its field (`go-to-issue.ts`): what
// is typed names an issue by its number, by `owner/name` and its number, or
// by its link on GitHub, and the recent issues matching it are offered
// below it.

/// An issue the Go to Issue field names: by its repository and number, or
/// by its number alone, in the repository on screen.
public struct IssueLocator: Hashable, Sendable {
    public var repository: RepositoryAddress?
    public var number: Int

    public init(repository: RepositoryAddress?, number: Int) {
        self.repository = repository
        self.number = number
    }

    /// The largest number GitHub asks for an issue by: a 32-bit `Int`.
    static let largestNumber = Int(Int32.max)

    /// Reads `#12` or `12`, `owner/name#12`, `owner/name 12`, or a link to
    /// an issue on GitHub; nothing else. An owner or name is ASCII letters,
    /// digits, `_`, `.` and `-`, as `\w` reads it on the desktop.
    public init?(parsing text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let link = Self.issueLink(trimmed) {
            self.init(checking: link.repository, link.number)
        } else if let match = trimmed.wholeMatch(of: /([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)(?:\s*#|\s+)([0-9]+)/) {
            self.init(
                checking: RepositoryAddress(owner: String(match.output.1), name: String(match.output.2)),
                String(match.output.3))
        } else if let match = trimmed.wholeMatch(of: /#?([0-9]+)/) {
            self.init(checking: nil, String(match.output.1))
        } else {
            return nil
        }
    }

    private init?(checking repository: RepositoryAddress?, _ digits: String) {
        guard let number = Int(digits) else { return nil }
        self.init(checking: repository, number)
    }

    private init?(checking repository: RepositoryAddress?, _ number: Int) {
        guard (1...Self.largestNumber).contains(number) else { return nil }
        self.init(repository: repository, number: number)
    }

    /// An issue's page on github.com, over HTTPS: `/owner/name/issues/12`.
    private static func issueLink(_ text: String) -> (repository: RepositoryAddress, number: String)? {
        guard let url = URL(string: text), url.scheme == "https",
            let host = url.host(), host == "github.com" || host == "www.github.com",
            let match = url.path(percentEncoded: true).wholeMatch(of: /\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/issues\/([0-9]+)\/?/)
        else { return nil }
        return (RepositoryAddress(owner: String(match.output.1), name: String(match.output.2)), String(match.output.3))
    }
}

/// Somewhere Go to Issue goes.
public enum GoToDestination: Hashable, Sendable {
    /// An issue to ask GitHub about first.
    case lookUp(RepositoryAddress, number: Int)
    /// A recent issue, which opens without asking GitHub.
    case recent(RecentIssue)

    /// `owner/name#12`.
    public var reference: String {
        switch self {
        case .lookUp(let repository, let number): "\(repository.nameWithOwner)#\(number)"
        case .recent(let issue): issue.reference
        }
    }
}

/// What Go to Issue offers for what is typed, and, when it offers nothing
/// for it, what it takes.
public struct GoToChoices: Equatable, Sendable {
    public var destinations: [GoToDestination]
    public var hint: String?

    /// The issue typed first, as the recent issue it is if it is one, then
    /// the recent issues whose `owner/name#12` or title has what is typed in
    /// it, each once. `from` is the repository a bare `#12` names, if any.
    public init(_ text: String, from: RepositoryAddress?, recents: [RecentIssue]) {
        let locator = IssueLocator(parsing: text)
        let repository = locator?.repository ?? from
        var typedRecent: RecentIssue?
        var typed: GoToDestination?
        if let locator, let repository {
            typedRecent = recents.first { $0.number == locator.number && $0.repository.sameRepository(as: repository) }
            typed = typedRecent.map(GoToDestination.recent) ?? .lookUp(repository, number: locator.number)
        }
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let matching = recents.filter { recent in
            recent != typedRecent
                && (query.isEmpty || recent.reference.lowercased().contains(query)
                    || recent.title.lowercased().contains(query))
        }
        destinations = (typed.map { [$0] } ?? []) + matching.map(GoToDestination.recent)
        if query.isEmpty || !destinations.isEmpty {
            hint = nil
        } else if let locator {
            hint = "#\(locator.number) names an issue only within a repository: choose one in the sidebar, or type owner/name#\(locator.number)."
        } else if from != nil {
            hint = "Type #12, owner/name#12 or a link to an issue on GitHub."
        } else {
            hint = "Type owner/name#12 or a link to an issue on GitHub."
        }
    }
}

extension RecentIssue {
    /// Its page on github.com.
    public var url: String { "https://github.com/\(repository.nameWithOwner)/issues/\(number)" }
}
