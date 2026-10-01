import Testing

#if DEBUG
  private let optimized = false
#else
  private let optimized = true
#endif

@inline(never)
private func read(_ key: Int) async throws -> [String] {
  try await Task.sleep(for: .milliseconds(1))
  return ["\(key)"]
}

/// Fails once the Swift that builds the app no longer has
/// https://github.com/swiftlang/swift/issues/92698: optimized builds never
/// write the first element of a tuple that a task returns as
/// `(key, .success(try await ...))` in do/catch. The app worked around it in
/// `IssuePagesStore.readFirstPages`, whose children returned a card's ID so
/// and crashed the app. When this fails, the workaround can go, and the
/// tuple is safe to return again. Run it with
/// `swift test -c release -Xswiftc -enable-testing`; a debug build has no
/// such bug.
@Test(.enabled(if: optimized, "The bug shows in optimized builds only."))
func swiftLosesTheKeyATaskReturnsBesideAnAwait() async {
  await withKnownIssue("swiftlang/swift#92698") {
    let keys = await withTaskGroup(of: (Int, Result<[String], any Error>).self) { group in
      for key in 1...3 {
        group.addTask {
          do { return (key, .success(try await read(key))) } catch { return (key, .failure(error)) }
        }
      }
      var keys: [Int] = []
      for await (key, _) in group { keys.append(key) }
      return keys.sorted()
    }
    #expect(keys == [1, 2, 3])
  }
}
