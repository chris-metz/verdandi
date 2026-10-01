import Foundation
import Observation
import VerdandiCore

/// Every issue read so far, by node ID, whichever list or page read it. Lists
/// and pages look issues up here, so a newer read shows everywhere.
@Observable
final class IssueStore {
  private(set) var issues: [String: Issue] = [:]
  /// Why an issue could not be read, by node ID.
  private(set) var failures: [String: GitHubError] = [:]
  @ObservationIgnored private var fetching: Set<String> = []

  subscript(id: String) -> Issue? { issues[id] }

  func store(_ issue: Issue) {
    var issue = issue
    // A search does not name the parent issue or sub-issues; keep those
    // read before.
    if let known = issues[issue.id], issue.parent == nil, issue.subIssues.isEmpty, issue.hasParent || issue.subIssuesTotal > 0 {
      issue.parent = known.parent
      issue.subIssues = known.subIssues
    }
    if issues[issue.id] != issue { issues[issue.id] = issue }
    failures[issue.id] = nil
  }

  func store(_ issues: some Sequence<Issue>) {
    for issue in issues { store(issue) }
  }

  /// Reads the issues not read yet, or all of them when `again`, 100 at a
  /// time. Those already being read are not asked for twice.
  func fetch(_ ids: some Sequence<String>, with client: any GitHubAccess, again: Bool = false) async {
    let wanted = Array(Set(ids).filter { (again || (issues[$0] == nil && failures[$0] == nil)) && !fetching.contains($0) })
    guard !wanted.isEmpty else { return }
    fetching.formUnion(wanted)
    defer { fetching.subtract(wanted) }
    for batch in wanted.chunked(into: 100) {
      await fetchBatch(batch, with: client)
    }
  }

  private func fetchBatch(_ batch: [String], with client: any GitHubAccess) async {
    do {
      let results = try await client.issues(ids: batch)
      for (id, result) in zip(batch, results) {
        switch result {
        case .success(let issue): store(issue)
        case .failure(let error): failures[id] = error
        }
      }
    } catch {
      for id in batch where !error.isTransient { failures[id] = error }
    }
  }
}

extension Array {
  func chunked(into size: Int) -> [[Element]] {
    stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
  }
}
