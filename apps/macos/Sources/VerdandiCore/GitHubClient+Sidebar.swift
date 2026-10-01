import Foundation

extension GitHubClient {
  /// The first `count` matches of an issue search, its text exactly as
  /// given, and how many there are in all. The sidebar counts a view's
  /// matches, and the view editor previews them, without reading a page of
  /// 100 issues each time.
  public func searchPreview(_ query: String, count: Int) async throws(GitHubError) -> SearchPage {
    let response = try await rest(
      [
        "search/issues", "-f", "q=\(query)", "-f", "advanced_search=true", "-f", "per_page=\(max(1, min(count, 100)))",
        "-f", "page=1",
      ],
      pool: .search)
    if response.status == 422 {
      let json = try? JSON(parsing: response.body)
      let message = json?["errors"]?[0]?["message"]?.string ?? json?["message"]?.string ?? "Validation Failed"
      throw .invalidSearch(message)
    }
    try response.throwIfFailed()
    guard let json = try? JSON(parsing: response.body), let items = json["items"]?.array else {
      throw .unexpectedResponse
    }
    var issues: [Issue] = []
    var pullRequests = 0
    for item in items {
      if let pullRequest = item["pull_request"], !pullRequest.isNull {
        pullRequests += 1
      } else if let issue = Self.readSearchMatch(item) {
        issues.append(issue)
      }
    }
    return SearchPage(
      total: json["total_count"]?.int ?? issues.count, incomplete: json["incomplete_results"]?.bool ?? false,
      issues: issues, pullRequests: pullRequests)
  }

  /// Where a repository is now, by GitHub's numeric ID, which survives
  /// renames and transfers, and a new repository taking over its old name.
  public func repositoryAddress(id: Int) async throws(GitHubError) -> RepositoryAddress {
    let response = try await rest(["repositories/\(id)"], pool: .core)
    try response.throwIfFailed()
    guard let json = try? JSON(parsing: response.body),
      let address = json["full_name"]?.string.flatMap(RepositoryAddress.init)
    else { throw .unexpectedResponse }
    return address
  }
}
