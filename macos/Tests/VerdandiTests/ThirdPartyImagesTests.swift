import Foundation
import Synchronization
import Testing

@testable import Verdandi
@testable import VerdandiCore

@MainActor
struct ThirdPartyImagesTests {
  private let address = URL(string: "https://example.com/a.png")!

  /// The first bytes of a PNG, enough to stand for one.
  private let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

  @Test func showsAnImageLoadedOnRequestAsADataURL() async {
    let png = png
    let images = ThirdPartyImages(load: { _ in .loaded(png, type: "image/png") })
    #expect(images.states[address] == nil)

    await images.load(address)

    #expect(images.states[address] == .loaded("data:image/png;base64,iVBORw0KGgo="))
  }

  @Test func loadsAnImageOnceHoweverOftenAsked() async {
    let png = png
    let calls = Mutex(0)
    let gate = Gate()
    let images = ThirdPartyImages(load: { _ in
      calls.withLock { $0 += 1 }
      await gate.wait()
      return .loaded(png, type: "image/png")
    })

    let first = Task { await images.load(address) }
    while images.states[address] != .loading { await Task.yield() }
    // Clicked again, or in another slice of the same body, while it loads.
    let again = Task { await images.load(address) }
    for _ in 0..<10 { await Task.yield() }
    #expect(images.states[address] == .loading)

    await gate.open()
    await first.value
    await again.value
    await images.load(address)
    #expect(images.states[address] == .loaded("data:image/png;base64,iVBORw0KGgo="))
    #expect(calls.withLock { $0 } == 1)
  }

  @Test func saysWhyAnImageCouldNotBeLoadedAndLoadsItWhenAskedAgain() async {
    let png = png
    let calls = Mutex(0)
    let images = ThirdPartyImages(load: { _ in
      calls.withLock { calls in
        calls += 1
        return calls
      } == 1 ? .failed("Cannot reach example.com") : .loaded(png, type: "image/png")
    })

    await images.load(address)
    #expect(images.states[address] == .failed("Cannot reach example.com"))

    await images.load(address)
    #expect(images.states[address] == .loaded("data:image/png;base64,iVBORw0KGgo="))
  }
}

/// Holds back whoever waits on it until it opens.
private actor Gate {
  private var isOpen = false
  private var waiting: [CheckedContinuation<Void, Never>] = []

  func wait() async {
    if isOpen { return }
    await withCheckedContinuation { waiting.append($0) }
  }

  func open() {
    isOpen = true
    for continuation in waiting { continuation.resume() }
    waiting = []
  }
}
