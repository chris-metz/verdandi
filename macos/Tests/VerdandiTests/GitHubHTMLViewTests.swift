import Foundation
import Testing
import WebKit

@testable import Verdandi

/// A body's web view as an issue page shows it, recording what it asks of
/// the page around it. It notes what the document's policy keeps from
/// loading, which then never reaches the network.
@MainActor
private final class Body {
  let html: String
  let view: WKWebView
  private let coordinator = GitHubWebView.Coordinator()
  private(set) var asked: [URL] = []
  private(set) var followed: [URL] = []

  init(_ html: String) async throws {
    self.html = html
    view = GitHubWebView.makeWebView(coordinator: coordinator)
    // Images and videos the policy lets through go no further either: the
    // tests reach no network.
    view.configuration.userContentController.add(try await Self.offline())
    view.configuration.userContentController.addUserScript(
      WKUserScript(
        source: """
          window.blocked = [];
          document.addEventListener("securitypolicyviolation", (event) => blocked.push(event.blockedURI));
          """,
        injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .defaultClient))
    show([:])
    coordinator.load(html, offset: 0, in: view)
  }

  private static func offline() async throws -> WKContentRuleList {
    let store = try #require(WKContentRuleListStore(url: URL.temporaryDirectory.appending(path: "verdandi-rules")))
    let rules = #"[{"trigger": {"url-filter": ".*", "resource-type": ["image", "media"]}, "action": {"type": "block"}}]"#
    return try #require(try await store.compileContentRuleList(forIdentifier: "offline", encodedContentRuleList: rules))
  }

  /// Shows the images from elsewhere in these states, as the page does as
  /// they load.
  func show(_ images: [URL: ThirdPartyImages.State]) {
    coordinator.parent = GitHubWebView(
      html: html, offset: 0, images: images,
      onLink: { [weak self] in self?.followed.append($0) },
      onLoadImage: { [weak self] in self?.asked.append($0) })
    coordinator.showImages(in: view)
  }

  func run(_ script: String) async throws -> Any? {
    try await view.callAsyncJavaScript(script, contentWorld: .defaultClient)
  }

  /// What each placeholder says.
  func placeholders() async throws -> [[String: String]] {
    try await run(
      """
      return [...document.querySelectorAll(".media-placeholder")].map((placeholder) => {
        const said = {};
        for (const part of placeholder.querySelectorAll("[data-part]")) {
          if (!part.hidden) said[part.dataset.part] = part.textContent;
        }
        return said;
      });
      """) as? [[String: String]] ?? []
  }

  /// The addresses the document's policy kept from loading.
  func blocked() async throws -> [String] {
    try await run("return blocked") as? [String] ?? []
  }

  /// Waits until the body's document has loaded, rather than the blank one
  /// a web view starts with.
  func loaded() async throws {
    try await until {
      try await run(#"return document.getElementById("content") !== null && document.readyState === "complete""#)
        as? Bool == true
    }
  }

  /// Waits until `condition` holds, for a few seconds at most.
  func until(_ condition: () async throws -> Bool) async throws {
    let deadline = ContinuousClock.now + .seconds(10)
    while try await !condition() {
      guard ContinuousClock.now < deadline else {
        Issue.record("Timed out")
        return
      }
      try await Task.sleep(for: .milliseconds(20))
    }
  }
}

@MainActor
struct GitHubHTMLViewTests {
  @Test func showsImagesFromElsewhereAsPlaceholdersThatNameTheirHost() async throws {
    let body = try await Body(
      """
      <p><img src="https://example.com/a.png" alt="Diagram"></p>
      <p><a href="docs/b.png"><img src="docs/b.png" alt="Image"></a></p>
      <p><img srcset="https://example.com/c.png 2x"></p>
      """)
    try await body.until { try await body.placeholders().count == 3 }

    #expect(
      try await body.placeholders() == [
        ["action": "Load image from example.com", "name": "Diagram"],
        ["action": "Load image from github.com"],
        ["action": "Load image from example.com"],
      ])
    #expect(try await body.run("return document.images.length") as? Int == 0)
    let blocked: Set = ["https://example.com/a.png", "https://github.com/docs/b.png", "https://example.com/c.png"]
    try await body.until { try await Set(body.blocked()) == blocked }
  }

  @Test func showsAPicturesImageFromGitHubWithoutItsSourcesFromElsewhere() async throws {
    let address = URL(string: "https://example.com/f.png")!
    let body = try await Body(
      """
      <picture id="logo"><source media="(prefers-color-scheme: dark)" srcset="https://example.com/dark.png">\
      <source srcset="https://camo.githubusercontent.com/d"><img src="https://camo.githubusercontent.com/c"></picture>
      <picture><source srcset="https://example.com/e.png"><img src="https://example.com/f.png" alt="Chart"></picture>
      """)
    try await body.until { try await body.placeholders().count == 1 }

    #expect(try await body.placeholders() == [["action": "Load image from example.com", "name": "Chart"]])
    #expect(
      try await body.run(##"return [...document.querySelectorAll("#logo source")].map((source) => source.srcset)"##)
        as? [String] == ["https://camo.githubusercontent.com/d"])

    let gif = "data:image/gif;base64,R0lGODlhAQABAAAAACw="
    body.show([address: .loaded(gif)])
    try await body.until { try await body.placeholders().isEmpty }
    // In place of its picture, whose sources would win over it.
    #expect(try await body.run("return document.querySelectorAll('picture').length") as? Int == 1)
    #expect(try await body.run(#"return document.querySelector("img[alt=Chart]").parentElement.id"#) as? String == "content")
  }

  @Test func showsGitHubsOwnEmojiAsTheirNames() async throws {
    let body = try await Body(
      #"<p>Ship it <img class="emoji" title=":shipit:" alt=":shipit:" src="https://github.githubassets.com/images/icons/emoji/shipit.png" height="20" width="20" align="absmiddle"></p>"#
    )
    try await body.loaded()

    #expect(try await body.placeholders().isEmpty)
    #expect(try await body.run("return document.querySelector('p').textContent") as? String == "Ship it :shipit:")
  }

  @Test func loadsImagesFromGitHubsMediaHostsAtOnce() async throws {
    let sources = [
      "https://camo.githubusercontent.com/8f1a/6874",
      "https://private-user-images.githubusercontent.com/1/2-uuid.png?jwt=x",
      "https://user-images.githubusercontent.com/1/2-uuid.png",
      "https://avatars.githubusercontent.com/u/1?v=4",
      "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    ]
    let body = try await Body(sources.map { #"<p><img src="\#($0)"></p>"# }.joined())
    try await body.loaded()

    #expect(try await body.placeholders().isEmpty)
    #expect(try await body.run("return [...document.images].map((image) => image.src)") as? [String] == sources)
    #expect(try await body.blocked().isEmpty)
  }

  @Test func loadsAnImageFromElsewhereOnceItsPlaceholderIsClicked() async throws {
    let address = URL(string: "https://example.com/a.png")!
    let body = try await Body(
      #"<p><a href="https://example.com/"><img src="https://example.com/a.png" alt="Diagram" width="120"></a></p>"#)
    try await body.until { try await body.placeholders().count == 1 }

    _ = try await body.run(#"document.querySelector(".media-placeholder").click()"#)
    try await body.until { !body.asked.isEmpty }
    #expect(body.asked == [address])

    body.show([address: .loading])
    try await body.until {
      try await body.placeholders() == [["action": "Loading image from example.com…", "name": "Diagram"]]
    }

    body.show([address: .failed("Cannot reach example.com")])
    try await body.until {
      try await body.placeholders() == [
        ["action": "Load image from example.com", "name": "Diagram", "reason": "Cannot reach example.com"]
      ]
    }

    let gif = "data:image/gif;base64,R0lGODlhAQABAAAAACw="
    body.show([address: .loaded(gif)])
    try await body.until { try await body.placeholders().isEmpty }
    let image = try await body.run(
      #"const image = document.querySelector("a > img"); return [image.src, image.alt, image.getAttribute("width")]"#)
    #expect(image as? [String] == [gif, "Diagram", "120"])
    // The click loaded the image rather than following the link around it.
    #expect(body.followed.isEmpty)
  }
}
