import Foundation
import Testing

@testable import VerdandiCore

private func address(_ text: String) -> RepositoryAddress { RepositoryAddress(text)! }

private let bug = Label(name: "bug", color: "d73a4a")
private let ready = Label(name: "ready-for-agent", color: "0e8a16")

// MARK: Reading what is kept

@Test func opensAgainOnTheViewChosenLast() {
  let settings = Settings(views: [SavedView(id: "v1", name: "Ready", query: "label:ready-for-agent")])
  let kept = LastEntry(item: .view(id: "v1"), labelFilter: [bug]).kept(in: settings)

  let restored = LastEntry(kept: kept, in: settings)
  #expect(restored.item == .view(id: "v1"))
  #expect(restored.labelFilter == [bug])

  // Removed while the app was closed: it opens on All, without the filter.
  let gone = LastEntry(kept: kept, in: Settings())
  #expect(gone.item == .all)
  #expect(gone.labelFilter.isEmpty)
}

@Test func findsTheRepositoryChosenLastUnderItsNewName() {
  let before = Settings(repositories: [TrackedRepository(address: address("a/old"), githubId: 7)])
  let kept = LastEntry(item: .repository(address("a/old")), labelFilter: [bug, ready]).kept(in: before)

  // Renamed while the app was closed, by the Electron app or by hand.
  let renamed = Settings(repositories: [
    TrackedRepository(address: address("c/d"), githubId: 3),
    TrackedRepository(address: address("b/new"), githubId: 7),
  ])
  let restored = LastEntry(kept: kept, in: renamed)
  #expect(restored.item == .repository(address("b/new")))
  #expect(restored.labelFilter == [bug, ready])

  // A repository that took over the old name is another one.
  let takenOver = Settings(repositories: [TrackedRepository(address: address("a/old"), githubId: 8)])
  #expect(LastEntry(kept: kept, in: takenOver) == LastEntry())
}

@Test func findsARepositoryKeptBeforeItsIDWasKnownByName() {
  let before = Settings(repositories: [TrackedRepository(address: address("a/b"))])
  let kept = LastEntry(item: .repository(address("a/b")), labelFilter: [bug]).kept(in: before)

  // GitHub's ID was stored since, and the name differs in case only.
  let identified = Settings(repositories: [TrackedRepository(address: address("A/B"), githubId: 7)])
  #expect(LastEntry(kept: kept, in: identified) == LastEntry(item: .repository(address("A/B")), labelFilter: [bug]))
  #expect(LastEntry(kept: kept, in: Settings()) == LastEntry())
}

@Test func opensAllWhenNothingReadableWasKept() {
  let settings = Settings(views: [SavedView(id: "v1", name: "Ready", query: "label:ready-for-agent")])
  #expect(LastEntry(kept: nil, in: settings) == LastEntry())
  #expect(LastEntry(kept: Data("view:v1".utf8), in: settings) == LastEntry())
  let all = LastEntry(item: .all, labelFilter: [ready])
  #expect(LastEntry(kept: all.kept(in: settings), in: settings) == all)
}
