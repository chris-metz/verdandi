import Foundation

/// The reads of GitHub that issue pages make. `GitHubClient` reads GitHub
/// through gh; tests read a GitHub they declare.
public protocol GitHubAccess: Sendable {
  /// Up to 100 issues by node ID. Each answer is in its place, an error
  /// for one GitHub would not show.
  func issues(ids: [String]) async throws(GitHubError) -> [Result<Issue, GitHubError>]
  /// An issue with what its page shows.
  func issueDetails(id: String) async throws(GitHubError) -> IssueDetails
  /// One page of the issues blocking an issue, or blocked by it.
  func relationships(
    of issueId: String, side: BlockingSide, after: String?, first: Int
  ) async throws(GitHubError) -> RelationshipPage
  /// One page of an issue's comments, oldest first.
  func comments(of issueId: String, after: String?) async throws(GitHubError) -> CommentPage
  /// What a repository numbers so: an issue, or a pull request.
  func item(numbered number: Int, in repository: RepositoryAddress) async throws(GitHubError) -> NumberedItem
}

extension GitHubClient: GitHubAccess {}
