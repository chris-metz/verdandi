import Foundation
import Testing

@testable import VerdandiCore

private func address(_ text: String) -> RepositoryAddress { RepositoryAddress(text)! }

private func summary(_ text: String, id: Int) -> RepositorySummary {
  RepositorySummary(id: id, repository: address(text), openIssueCount: 1, hasIssuesEnabled: true, isArchived: false)
}

private func access(_ text: String, id: Int, organization: Bool = false) -> RepositoryAccess {
  RepositoryAccess(
    id: id, repository: address(text), ownedByOrganization: organization, hasIssuesEnabled: true, isArchived: false,
    issuesDenied: nil)
}

// MARK: Renames and transfers

@Test func identifiesRenamedRepositories() {
  let tracked = TrackedRepository(address: address("a/old"), githubId: 7)
  #expect(tracked.identity(from: summary("a/old", id: 7)) == .unchanged)
  #expect(
    tracked.identity(from: summary("b/new", id: 7))
      == .identified(TrackedRepository(address: address("b/new"), githubId: 7)))
  #expect(tracked.identity(from: summary("a/old", id: 8)) == .takenOver(by: 8))
  // A change of case is a rename too, and an ID not stored yet is stored.
  #expect(tracked.identity(from: summary("A/Old", id: 7)) != .unchanged)
  #expect(TrackedRepository(address: address("a/old")).identity(from: summary("a/old", id: 7)) != .unchanged)
}

@Test func storesNewAddressesWithoutDuplicates() {
  var settings = Settings(repositories: [
    TrackedRepository(address: address("a/old"), githubId: 7),
    TrackedRepository(address: address("c/d")),
    TrackedRepository(address: address("b/new")),
  ])
  settings.identify([address("a/old"): TrackedRepository(address: address("b/new"), githubId: 7)])
  #expect(settings.repositories.map(\.address.description) == ["b/new", "c/d"])
  #expect(settings.repositories[0].githubId == 7)
}

@Test func doesNotIdentifyAnotherRepository() {
  var settings = Settings(repositories: [TrackedRepository(address: address("a/b"), githubId: 1)])
  settings.identify([address("a/b"): TrackedRepository(address: address("a/b"), githubId: 2)])
  #expect(settings.repositories[0].githubId == 1)
}

// MARK: Adding, removing, views

@Test func tracksEachRepositoryOnce() {
  var settings = Settings(repositories: [
    TrackedRepository(address: address("a/b")), TrackedRepository(address: address("c/d"), githubId: 4),
  ])
  let added = settings.track([
    TrackedRepository(address: address("A/B"), githubId: 1),
    TrackedRepository(address: address("c/renamed"), githubId: 4),
    TrackedRepository(address: address("e/f"), githubId: 5),
  ])
  #expect(added.map(\.address.description) == ["e/f"])
  #expect(settings.repositories.map(\.address.description) == ["A/B", "c/renamed", "e/f"])
  #expect(settings.repositories.map(\.githubId) == [1, 4, 5])
  settings.untrack(address("a/b"))
  #expect(settings.repositories.count == 2)
}

@Test func savesViewsInPlaceOrAfterTheirOriginal() {
  var settings = Settings(views: [
    SavedView(id: "1", name: "One", query: "q1"), SavedView(id: "2", name: "Two", query: "q2"),
  ])
  let copy = settings.views[0].duplicate
  #expect(copy.name == "One Copy")
  #expect(copy.id != "1")
  settings.save(copy, after: "1")
  #expect(settings.views.map(\.name) == ["One", "One Copy", "Two"])
  settings.save(SavedView(id: "2", name: "Second", query: "q"))
  #expect(settings.views.map(\.name) == ["One", "One Copy", "Second"])
  settings.removeView(id: "1")
  #expect(settings.views.map(\.name) == ["One Copy", "Second"])
}

// MARK: The picker

@Test func readsRepositoriesTypedOrPasted() {
  #expect(RepositoryAddress.fromInput(" cli/cli ") == address("cli/cli"))
  #expect(RepositoryAddress.fromInput("https://github.com/cli/cli/issues/12") == address("cli/cli"))
  #expect(RepositoryAddress.fromInput("github.com/cli/cli.git") == address("cli/cli"))
  #expect(RepositoryAddress.fromInput("git@github.com:cli/cli.git") == address("cli/cli"))
  #expect(RepositoryAddress.fromInput("https://gitlab.com/cli/cli") == nil)
  #expect(RepositoryAddress.fromInput("cli") == nil)
}

@Test func groupsSuggestionsByOwner() {
  let repositories = [
    access("zed/tool", id: 1), access("org2/x", id: 2, organization: true), access("me/a", id: 3),
    access("org1/y", id: 4, organization: true), access("me/b", id: 5),
  ]
  let groups = groupSuggestions(repositories, account: "Me", organizations: ["org1", "org2"])
  #expect(groups.map(\.owner) == ["me", "org1", "org2", "zed"])
  #expect(groups.map(\.kind) == [.account, .organization, .organization, .other])
  #expect(groups[0].repositories.map(\.id) == [3, 5])
  let filtered = groupSuggestions(repositories, account: "me", organizations: [], matching: "ME b")
  #expect(filtered.flatMap(\.repositories).map(\.id) == [5])
  let pasted = groupSuggestions(repositories, account: "me", organizations: [], matching: "https://github.com/org1/y")
  #expect(pasted.flatMap(\.repositories).map(\.id) == [4])
}

// MARK: View scope

@Test func describesWhatAViewSearches() {
  #expect(ViewScope(query: "is:open assignee:@me").targets == nil)
  #expect(ViewScope(query: "repo:a/b is:open").targets == [.repository("a/b")])
  #expect(ViewScope(query: "(repo:a/b OR org:c) is:open").targets == [.repository("a/b"), .owner("c")])
  // An alternative without a limit lifts it.
  #expect(ViewScope(query: "repo:a/b OR is:open").targets == nil)
  #expect(ViewScope(query: "repo:a/b repo:c/d").combinedRepositories == ["a/b", "c/d"])
  #expect(ViewScope(query: "repo:a/b OR repo:c/d").combinedRepositories == nil)
  #expect(ViewScope(query: "(repo:a/b").targets == [.repository("a/b")])
}

// MARK: Watching settings.json

/// Counts a watcher's calls, and waits for them.
private final class Calls: @unchecked Sendable {
  private let lock = NSLock()
  private var count = 0
  var value: Int { lock.withLock { count } }
  func add() { lock.withLock { count += 1 } }

  func wait(for expected: Int, timeout: Duration = .seconds(3)) async {
    let deadline = ContinuousClock.now + timeout
    while value < expected, ContinuousClock.now < deadline {
      try? await Task.sleep(for: .milliseconds(20))
    }
  }
}

@Test func watchesEditsInPlaceAndAtomicWrites() async throws {
  let folder = FileManager.default.temporaryDirectory.appending(path: "watch-\(UUID().uuidString)")
  defer { try? FileManager.default.removeItem(at: folder) }
  let file = folder.appending(path: "settings.json")
  let calls = Calls()
  let watcher = FileWatcher(url: file, debounce: .milliseconds(50)) { calls.add() }
  watcher.start()
  defer { watcher.stop() }

  // Created where there was none.
  try Data("one".utf8).write(to: file)
  await calls.wait(for: 1)
  #expect(calls.value == 1)

  // Replaced by an atomic write, a rename over it.
  try Data("two".utf8).write(to: file, options: .atomic)
  await calls.wait(for: 2)
  #expect(calls.value == 2)

  // Edited in place, in the file the atomic write left.
  let handle = try FileHandle(forWritingTo: file)
  try handle.seekToEnd()
  try handle.write(contentsOf: Data(" more".utf8))
  try handle.close()
  await calls.wait(for: 3)
  #expect(calls.value == 3)

  // The same contents again are no change.
  try Data("two more".utf8).write(to: file, options: .atomic)
  try await Task.sleep(for: .milliseconds(300))
  #expect(calls.value == 3)

  // Deleted.
  try FileManager.default.removeItem(at: file)
  await calls.wait(for: 4)
  #expect(calls.value == 4)
}
