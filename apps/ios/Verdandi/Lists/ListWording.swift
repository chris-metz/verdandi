import Foundation
import VerdandiKit

// What a list and a view say of themselves, in the desktop's words
// (`list-status.ts`, `freshness.ts`, `view-screen.ts`): counts only once
// everything has loaded, so that missing data never reads as an empty
// repository; how current it is; and what of it could not be read.

enum ListWording {
    /// The line under a list's issues. With a label filter, it counts the
    /// matches among the issues in the list's state.
    static func status(_ list: IssueList) -> String {
        switch list.loading.state {
        case .loading:
            return loadingStatus(list)
        case .failed(let problem):
            return "Not every \(list.state.rawValue) issue could be loaded · \(ProblemText(problem).text)"
        default:
            guard let counts = list.loading.counts else { return "" }
            if !list.labelFilter.isEmpty {
                return labelFilterStatus(
                    matches: counts.matches, inScope: counts.inScope, labels: list.labelFilter, state: list.state)
            }
            let listed = listed(counts.matches, state: list.state)
            guard counts.closedNotListed > 0 else { return listed }
            let closed =
                counts.closedNotListed == 1
                ? "1 closed issue with no open sub-issues is not listed"
                : "\(count(counts.closedNotListed)) closed issues with no open sub-issues are not listed"
            return "\(listed) · \(closed)"
        }
    }

    /// The counts a list's title shows below it: the status, short of the
    /// closed issues it leaves out, which need more words. While All loads
    /// its open issues, how many of its repositories have.
    static func counts(_ list: IssueList) -> String {
        switch list.loading.state {
        case .loading:
            if list.state == .open, !list.repositories.isEmpty {
                let loaded = list.repositories.filter { $0.loading.updatedAt != nil }.count
                let total = list.repositories.count
                return "Loading… \(loaded) of \(total) \(total == 1 ? "repository" : "repositories")"
            }
            return loadingStatus(list)
        case .failed:
            return ""
        default:
            guard let counts = list.loading.counts else { return "" }
            if !list.labelFilter.isEmpty {
                return labelFilterStatus(
                    matches: counts.matches, inScope: counts.inScope, labels: list.labelFilter, state: list.state)
            }
            return listed(counts.matches, state: list.state)
        }
    }

    /// How far a list's first read has come: only a closed list counts the
    /// issues it has read.
    private static func loadingStatus(_ list: IssueList) -> String {
        if list.state == .open { return "Loading…" }
        guard let progress = list.loading.progress, let total = progress.total else {
            return "Loading closed issues…"
        }
        return "Loading closed issues… \(count(progress.read)) of \(count(total))"
    }

    /// A sort order's name in a list in a state: Newest is Recently closed
    /// in a closed list.
    static func name(of order: ListSortOrder, in state: IssueState) -> String {
        IssueDate(order, in: state).sortOrderName
    }

    /// "No open issues", "1 open issue", "12 closed issues".
    private static func listed(_ matches: Int, state: IssueState) -> String {
        matches == 0
            ? "No \(state.rawValue) issues"
            : "\(count(matches)) \(state.rawValue) \(matches == 1 ? "issue" : "issues")"
    }

    /// How many of the issues in a scope carry every label of its label
    /// filter, naming the labels: "3 of 12 open issues have bug, ui". A
    /// view's issues are in any state.
    static func labelFilterStatus(matches: Int, inScope: Int, labels: [IssueLabel], state: IssueState? = nil)
        -> String
    {
        let names = labels.map(\.name).joined(separator: ", ")
        func issues(_ plural: Bool) -> String {
            [state?.rawValue, plural ? "issues" : "issue"].compactMap { $0 }.joined(separator: " ")
        }
        if matches == 0 { return "No \(issues(true)) have \(names)" }
        return "\(count(matches)) of \(count(inScope)) \(issues(inScope != 1)) \(matches == 1 ? "has" : "have") \(names)"
    }

    /// How a view counts its matches, as GitHub counts them: "7 matches";
    /// "100 of 4,213 matches shown" when fewer are listed; and the pull
    /// requests among them, which are never listed.
    static func matches(matchCount: Int, pullRequests: Int, listed: Int) -> String {
        let total = count(matchCount)
        let matches =
            listed + pullRequests < matchCount
            ? "\(count(listed)) of \(total) matches shown"
            : "\(total) \(matchCount == 1 ? "match" : "matches")"
        guard pullRequests > 0 else { return matches }
        return "\(matches) · \(count(pullRequests)) \(pullRequests == 1 ? "pull request" : "pull requests") not listed"
    }

    /// What a view says while its search runs or its context loads, else
    /// its matches.
    static func counts(_ view: ViewList) -> String {
        if case .loading = view.loading {
            guard let searching = view.searching, let pages = searching.pages, pages > 1 else { return "Searching…" }
            return "Searching… page \(searching.page) of \(pages)"
        }
        if case .failed = view.loading { return "" }
        if view.readingContext { return "Loading parent issues and sub-issues…" }
        if !view.labelFilter.isEmpty, view.inScope > 0 {
            return labelFilterStatus(matches: view.matchesShown, inScope: view.inScope, labels: view.labelFilter)
        }
        if let matchCount = view.matchCount {
            return matches(matchCount: matchCount, pullRequests: view.pullRequests, listed: view.inScope)
        }
        return ""
    }

    /// How current what a screen shows is: "Updated 3 min ago", "Updating…"
    /// while it is read again, or the time it is from when reading it again
    /// failed.
    static func freshness(_ loading: LoadingState, now: Date) -> String? {
        switch loading {
        case .refreshing: "Updating…"
        case .current(let at), .partial(let at, _): updatedAgo(Date(timeIntervalSince1970: at / 1000), now: now)
        case .stale(let at, _): "Showing data from \(timeOf(Date(timeIntervalSince1970: at / 1000), now: now))"
        case .loading, .failed: nil
        }
    }

    /// "Updated just now" within the first minute, then whole minutes, then
    /// whole hours.
    static func updatedAgo(_ date: Date, now: Date) -> String {
        let minutes = Int(now.timeIntervalSince(date) / 60)
        if minutes < 1 { return "Updated just now" }
        if minutes < 60 { return "Updated \(minutes) min ago" }
        return "Updated \(minutes / 60) h ago"
    }

    /// When data was read, by the clock: "14:02" today, with the date on
    /// another day.
    static func timeOf(_ date: Date, now: Date) -> String {
        if Calendar.current.isDate(date, inSameDayAs: now) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        return date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
    }

    /// What of a forest could not be read, and the parents it names:
    /// "2 issues could not be loaded", "1 issue unavailable", "3 issues
    /// shown in part".
    static func missing(trees: [IssueNode], named: [UnreadIssue]) -> [String] {
        var failures: [Problem] = []
        var incomplete = 0
        func visit(_ node: IssueNode) {
            if case .failed(let problem) = node.unread {
                failures.append(problem)
            } else if node.unread == nil, node.issue.incomplete != nil {
                incomplete += 1
            }
            node.subIssues.forEach(visit)
        }
        trees.forEach(visit)
        for case .failed(let problem) in named { failures.append(problem) }
        var notes = countFailures(failures, one: "issue", many: "issues")
        if incomplete > 0 { notes.append("\(incomplete) \(incomplete == 1 ? "issue" : "issues") shown in part") }
        return notes
    }

    /// Counts failures of one kind of thing, those GitHub will not show
    /// apart from those that could not be read.
    static func countFailures(_ problems: [Problem], one: String, many: String) -> [String] {
        let unavailable = problems.filter { if case .unavailable = $0 { true } else { false } }.count
        let failed = problems.count - unavailable
        func name(_ count: Int) -> String { "\(count) \(count == 1 ? one : many)" }
        var notes: [String] = []
        if unavailable > 0 { notes.append("\(name(unavailable)) unavailable") }
        if failed > 0 { notes.append("\(name(failed)) could not be loaded") }
        return notes
    }

    static func count(_ value: Int) -> String { value.formatted() }
}

/// A strip above a view's matches, saying what they leave out.
struct ViewStrip: Hashable {
    var text: String
    /// What follows from it, in more words.
    var hint: String
    /// Whether running the search again may help.
    var retry: Bool

    /// What a view's strips say once its search has read every page of its
    /// first run: that it shows only the first 1,000 of more matches, and
    /// that GitHub did not return all matches. Either way, context issues
    /// may match too.
    static func of(_ view: ViewList) -> [ViewStrip] {
        switch view.loading {
        case .loading, .failed: return []
        default: break
        }
        var strips: [ViewStrip] = []
        if let matchCount = view.matchCount, matchCount > 1000 {
            let sort = view.query.split(separator: " ").first { $0.hasPrefix("sort:") }
            strips.append(
                ViewStrip(
                    text:
                        "\(ListWording.count(view.inScope)) of \(ListWording.count(matchCount)) matches shown · narrow the search",
                    hint: sort.map { "\($0) in the search decides which 1,000; context issues may match too" }
                        ?? "Without sort: in the search, GitHub returns the newest-created 1,000; context issues may match too",
                    retry: false))
        }
        if view.incomplete {
            strips.append(
                ViewStrip(text: "GitHub did not return all matches", hint: "Context issues may match too.", retry: true))
        }
        return strips
    }
}

extension ViewList {
    var query: String { view.query }
}
