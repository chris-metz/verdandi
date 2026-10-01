import Foundation
import Synchronization

@testable import VerdandiCore

/// A GitHub a test declares: issues of `o/r`, each named by its node ID, and
/// which of them block which. It answers at once.
final class FakeGitHub: GitHubAccess {
  private struct State {
    var issues: [String: VerdandiCore.Issue] = [:]
    var lists: [BlockingListKey: [String]] = [:]
  }

  private let state = Mutex(State())

  /// Adds open issues.
  func add(_ ids: String...) {
    state.withLock { state in
      for id in ids {
        state.issues[id] = VerdandiCore.Issue(
          id: id, repository: RepositoryAddress(owner: "o", name: "r"), number: state.issues.count + 1, title: id,
          state: .open, url: URL(string: "https://github.com/o/r/issues/\(state.issues.count + 1)")!,
          author: nil, createdAt: .now, closedAt: nil, labels: [], parent: nil, subIssues: [], hasParent: false,
          subIssuesTotal: 0, subIssuesCompleted: 0, blockedBy: 0, totalBlockedBy: 0, blocking: 0, totalBlocking: 0)
      }
    }
  }

  /// Says that `blocker` blocks each of `blocked`, which must have been
  /// added.
  func block(_ blocker: String, _ blocked: String...) {
    state.withLock { state in
      for other in blocked {
        state.lists[BlockingListKey(blocker, .blocking), default: []].append(other)
        state.lists[BlockingListKey(other, .blockedBy), default: []].append(blocker)
        state.issues[blocker]!.blocking += 1
        state.issues[blocker]!.totalBlocking += 1
        state.issues[other]!.blockedBy += 1
        state.issues[other]!.totalBlockedBy += 1
      }
    }
  }

  // MARK: GitHubAccess

  func issues(ids: [String]) async throws(GitHubError) -> [Result<VerdandiCore.Issue, GitHubError>] {
    state.withLock { state in
      ids.map { id in state.issues[id].map { .success($0) } ?? .failure(.unavailable("No issue \(id).")) }
    }
  }

  func issueDetails(id: String) async throws(GitHubError) -> IssueDetails {
    guard let issue = state.withLock({ $0.issues[id] }) else { throw .unavailable("No issue \(id).") }
    return IssueDetails(issue: issue, stateReason: nil, assignees: [], milestone: nil, commentCount: 0, bodyHTML: "")
  }

  /// A page of `first` issues, after the cursor of the page before.
  func relationships(
    of issueId: String, side: BlockingSide, after: String?, first: Int
  ) async throws(GitHubError) -> RelationshipPage {
    try state.withLock { state throws(GitHubError) in
      guard state.issues[issueId] != nil else { throw .unavailable("No issue \(issueId).") }
      let ids = state.lists[BlockingListKey(issueId, side)] ?? []
      let start = after.flatMap(Int.init) ?? 0
      let end = min(start + first, ids.count)
      return RelationshipPage(
        issues: ids[start..<end].map { state.issues[$0]! }, totalCount: ids.count,
        nextPage: end < ids.count ? String(end) : nil, incomplete: nil)
    }
  }

  func comments(of issueId: String, after: String?) async throws(GitHubError) -> CommentPage {
    CommentPage(comments: [], nextPage: nil)
  }

  func item(numbered number: Int, in repository: RepositoryAddress) async throws(GitHubError) -> NumberedItem {
    guard let issue = state.withLock({ $0.issues.values.first { $0.repository == repository && $0.number == number } })
    else { throw .unavailable("There is no issue \(repository.reference(number)).") }
    return .issue(issue.reference, url: issue.url)
  }
}
