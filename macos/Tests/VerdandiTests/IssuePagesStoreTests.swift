import Testing

@testable import Verdandi
@testable import VerdandiCore

@MainActor
struct IssuePagesStoreTests {
  /// `root` is blocked by a, b and c, which are blocked by others in turn,
  /// and blocks d, which blocks e.
  private func github() -> FakeGitHub {
    let github = FakeGitHub()
    github.add("root", "a", "b", "c", "a1", "a2", "b1", "c1", "c2", "c3", "d", "e")
    github.block("a", "root")
    github.block("b", "root")
    github.block("c", "root")
    github.block("a1", "a")
    github.block("a2", "a")
    github.block("b1", "b")
    github.block("c1", "c")
    github.block("c2", "c")
    github.block("c3", "c")
    github.block("root", "d")
    github.block("d", "e")
    return github
  }

  private func store(_ github: FakeGitHub) -> IssuePagesStore {
    IssuePagesStore(issues: IssueStore(), client: { github }, openIssue: { _ in })
  }

  private func list(_ page: IssuePageModel, _ id: String, _ side: BlockingSide) -> [String]? {
    page.blockingLists[BlockingListKey(id, side)]?.ids
  }

  @Test func readsTheMapTwoStepsOutOnEachSide() async {
    let store = store(github())
    await store.open("root")
    let page = store.page(for: "root")

    #expect(list(page, "root", .blockedBy) == ["a", "b", "c"])
    #expect(list(page, "a", .blockedBy) == ["a1", "a2"])
    #expect(list(page, "b", .blockedBy) == ["b1"])
    #expect(list(page, "c", .blockedBy) == ["c1", "c2", "c3"])
    #expect(list(page, "root", .blocking) == ["d"])
    #expect(list(page, "d", .blocking) == ["e"])
    // The cards of the last step only say how many lie beyond.
    #expect(list(page, "a1", .blockedBy) == nil)
    #expect(page.mapPhase.error == nil && !page.mapPhase.isLoading)
  }

  /// Reading the relationships of a step's cards crashed the app now and
  /// then, as a child task of the task group finished, and read wrong ones
  /// before: a bug of Swift 6.4, which a child that awaited inside the
  /// tuple it returned set off. It shows in release builds only:
  /// `swift test -c release -Xswiftc -enable-testing` failed this test
  /// every time before the fix.
  @Test func readsManyMapsOneAfterAnother() async {
    let github = github()
    for _ in 0..<2000 {
      let store = store(github)
      await store.open("root")
      let page = store.page(for: "root")
      #expect(list(page, "c", .blockedBy) == ["c1", "c2", "c3"])
    }
  }
}
