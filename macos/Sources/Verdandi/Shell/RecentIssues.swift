import Foundation
import VerdandiCore

/// An issue gone to with Go to Issue, remembered to go to again without
/// asking GitHub.
struct RecentIssue: Codable, Hashable, Identifiable {
  /// GitHub's node ID.
  var id: String
  var repository: RepositoryAddress
  var number: Int
  var title: String
  var state: IssueState

  init(_ reference: IssueReference) {
    id = reference.id
    repository = reference.repository
    number = reference.number
    title = reference.title
    state = reference.state
  }

  var reference: IssueReference {
    IssueReference(id: id, repository: repository, number: number, title: title, state: state)
  }

  var qualifiedReference: String { repository.reference(number) }
}

/// The last issues gone to, newest first, kept in UserDefaults on this Mac.
enum RecentIssues {
  static let key = "recentIssues"
  static let limit = 8

  static func load() -> [RecentIssue] {
    guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
    return (try? JSONDecoder().decode([RecentIssue].self, from: data)) ?? []
  }

  /// Puts an issue first, once.
  static func record(_ reference: IssueReference) {
    var recents = load().filter { $0.id != reference.id }
    recents.insert(RecentIssue(reference), at: 0)
    if let data = try? JSONEncoder().encode(Array(recents.prefix(limit))) {
      UserDefaults.standard.set(data, forKey: key)
    }
  }
}
