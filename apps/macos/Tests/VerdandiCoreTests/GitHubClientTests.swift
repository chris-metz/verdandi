import Foundation
import Testing

@testable import VerdandiCore

@Test func readsAnIncludeTranscript() throws {
  let response = try #require(
    HTTPResponse(
      transcript: "HTTP/2.0 200 OK\r\nX-Ratelimit-Limit: 5000\r\nX-Ratelimit-Remaining: 4990\r\nX-Ratelimit-Reset: 1700000000\r\nX-Ratelimit-Resource: search\r\n\r\n{\"a\":1}"
    ))
  #expect(response.status == 200)
  #expect(response.body == "{\"a\":1}")
  let budget = try #require(response.budget(pool: .core))
  #expect(budget.pool == .search)
  #expect(budget.remaining == 4990)
}

@Test func readsSettingsTheElectronAppWrote() throws {
  let settings = try SettingsFile.parse(
    Data(
      """
      {"version": 1, "repositories": [{"name": "a/b"}, {"name": "c/d", "id": 7}],
       "views": [{"id": "x", "name": "Mine", "query": "is:open"}, {"name": "No ID", "query": "q"}]}
      """.utf8))
  #expect(settings.repositories.map(\.address.description) == ["a/b", "c/d"])
  #expect(settings.repositories[1].githubId == 7)
  #expect(settings.views[0].id == "x")
  #expect(settings.views[1].id.count == 12)
}

@Test func comparesRepositoriesWithoutCase() {
  #expect(RepositoryAddress("Chris-Metz/Verdandi") == RepositoryAddress("chris-metz/verdandi"))
  #expect(RepositoryAddress("nope") == nil)
}

/// Reads real issues through the gh on this computer: `VERDANDI_LIVE=1 swift test`.
@Test(.enabled(if: ProcessInfo.processInfo.environment["VERDANDI_LIVE"] == "1"))
func readsLiveIssues() async throws {
  guard case .found(let gh) = await findGh(chosen: nil) else {
    Issue.record("no gh")
    return
  }
  let client = GitHubClient(gh: gh.url)
  let status = try await client.authStatus()
  print("auth:", status)
  let page = try await client.issues(in: RepositoryAddress("chris-metz/verdandi")!, state: .open)
  print("open issues:", page.issues.count, "closed:", page.closedIssueCount, "next:", page.nextPage ?? "-")
  #expect(!page.issues.isEmpty)
  let withParent = page.issues.first { $0.parent != nil }
  print("with parent:", withParent?.qualifiedReference ?? "-", withParent?.parent?.qualifiedReference ?? "")
  let details = try await client.issueDetails(id: page.issues[0].id)
  print("details:", details.issue.title, details.bodyHTML.prefix(80))
  let blocked = try await client.relationships(of: page.issues[0].id, side: .blockedBy)
  print("blocked by:", blocked.totalCount)
  let search = try await client.searchIssues("repo:chris-metz/verdandi is:issue label:ready-for-agent", page: 1)
  print("search:", search.total, search.issues.map(\.number))
  let summaries = try await client.repositorySummaries([RepositoryAddress("chris-metz/verdandi")!, RepositoryAddress("chris-metz/doesnotexist123")!])
  print("summaries:", summaries)
  let suggestions = try await client.repositorySuggestions()
  print("suggestions:", suggestions.account, suggestions.organizations ?? [], suggestions.repositories.count)
}
