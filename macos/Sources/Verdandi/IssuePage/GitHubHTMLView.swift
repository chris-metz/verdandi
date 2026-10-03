import AppKit
import SwiftUI
import WebKit

/// HTML GitHub rendered for an issue's body or a comment, in a web view
/// styled like the rest of the page: system font, its colours in light and
/// dark, a transparent background. It is as tall as its content, so the
/// page scrolls as one, and its links are handed to `onLink` rather than
/// followed. Nothing in it runs: script from the content is off. Images and
/// videos load only from GitHub's media hosts (ADR 0003); an image from
/// elsewhere shows as a placeholder, and loads once the user clicks it.
///
/// A web view much taller than a few screens draws nothing, so a long body
/// shows in slices: web views one under the other, each showing its part.
struct GitHubHTMLView: View {
  @Environment(AppModel.self) private var model
  var html: String
  /// The height measured before, to take its place at once.
  var knownHeight: CGFloat?
  var onLink: (URL) -> Void
  var onHeight: (CGFloat) -> Void = { _ in }

  @State private var height: CGFloat?
  /// The images from elsewhere the user asked for in this body, which only
  /// then show, though at once when one loaded before.
  @State private var requested: Set<URL> = []

  /// The tallest a slice is.
  static let sliceHeight: CGFloat = 4000

  var body: some View {
    let total = max(height ?? knownHeight ?? 20, 1)
    let slices = max(1, Int((total / Self.sliceHeight).rounded(.up)))
    VStack(spacing: 0) {
      ForEach(0..<slices, id: \.self) { index in
        slice(index, of: total)
      }
    }
  }

  private func slice(_ index: Int, of total: CGFloat) -> some View {
    let offset = CGFloat(index) * Self.sliceHeight
    let report: ((CGFloat) -> Void)? = index == 0 ? { measured($0) } : nil
    let images = model.images
    return GitHubWebView(
      html: html, offset: offset, images: images.states.filter { requested.contains($0.key) }, onLink: onLink,
      onLoadImage: { url in
        requested.insert(url)
        Task { await images.load(url) }
      }, onHeight: report
    )
    .frame(height: min(Self.sliceHeight, total - offset))
  }

  private func measured(_ measured: CGFloat) {
    guard height != measured else { return }
    height = measured
    onHeight(measured)
  }
}

/// A web view under `GitHubHTMLView`, showing the document from `offset`
/// down.
struct GitHubWebView: NSViewRepresentable {
  var html: String
  var offset: CGFloat
  /// The images from elsewhere the user asked for, by address.
  var images: [URL: ThirdPartyImages.State]
  var onLink: (URL) -> Void
  /// Where a click on an image's placeholder goes, with its address.
  var onLoadImage: (URL) -> Void
  /// Where the content's height goes, for the slice that measures it.
  var onHeight: ((CGFloat) -> Void)?

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeNSView(context: Context) -> PageWebView {
    let view = Self.makeWebView(coordinator: context.coordinator)
    context.coordinator.parent = self
    context.coordinator.load(html, offset: offset, in: view)
    return view
  }

  func updateNSView(_ view: PageWebView, context: Context) {
    context.coordinator.parent = self
    if context.coordinator.html != html || context.coordinator.offset != offset {
      context.coordinator.load(html, offset: offset, in: view)
    } else {
      context.coordinator.showImages(in: view)
    }
  }

  static func dismantleNSView(_ view: PageWebView, coordinator: Coordinator) {
    view.configuration.userContentController.removeAllScriptMessageHandlers()
    view.navigationDelegate = nil
    view.uiDelegate = nil
  }

  /// A web view for a body, whose script and links `coordinator` answers.
  static func makeWebView(coordinator: Coordinator) -> PageWebView {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = Self.dataStore
    configuration.defaultWebpagePreferences.allowsContentJavaScript = false
    let scripts = WKUserContentController()
    // The images go first: nothing of the app's touches an image that may
    // not load.
    scripts.addUserScript(
      WKUserScript(
        source: Self.imagesScript + Self.measureScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true,
        in: .defaultClient))
    for name in ["height", "placeholders", "loadImage"] {
      scripts.add(coordinator, contentWorld: .defaultClient, name: name)
    }
    configuration.userContentController = scripts

    let view = PageWebView(frame: .zero, configuration: configuration)
    view.setValue(false, forKey: "drawsBackground")
    view.underPageBackgroundColor = .clear
    view.allowsMagnification = false
    view.allowsBackForwardNavigationGestures = false
    if LaunchOptions.windowFile != nil,
      view.responds(to: NSSelectorFromString("_setWindowOcclusionDetectionEnabled:"))
    {
      // WebKit draws nothing while the window is covered, as a window being
      // screenshotted without being brought to the front is.
      view.setValue(false, forKey: "windowOcclusionDetectionEnabled")
    }
    view.navigationDelegate = coordinator
    view.uiDelegate = coordinator
    return view
  }

  /// One store for every body, kept in memory only: nothing a body loads
  /// stays on disk, and no GitHub cookies reach it.
  static let dataStore = WKWebsiteDataStore.nonPersistent()

  /// Shows each image whose address is not on GitHub's media hosts as a
  /// placeholder that names its host, in place of its picture if it has
  /// one; GitHub's own emoji, such as `:shipit:`, show as their names. The
  /// document's policy kept them from loading; a click on a placeholder asks
  /// the app for its image. Alternatives of an image from GitHub that are
  /// not, in `srcset` or a picture's sources, go, so that it shows. It tells
  /// the app the addresses it shows placeholders for, and
  /// `verdandiShowImage` then shows each as it loads, fails or has loaded.
  /// It runs in the app's own script world, which the content cannot reach.
  static let imagesScript = #"""
    (() => {
      const content = document.getElementById("content");
      if (!content) return;
      const mediaHosts = new Set(\#(GitHubHTMLDocument.mediaHostsJSON));
      const resolve = (address) => {
        try {
          return new URL(address, document.baseURI);
        } catch {
          return null;
        }
      };
      /** Whether an image may load from an address at once. */
      const loadsAtOnce = (address) => {
        const url = resolve(address);
        if (url?.protocol === "data:") return true;
        return url?.protocol === "https:" && mediaHosts.has(url.host) && !url.username && !url.password;
      };
      const candidates = (element) =>
        (element.getAttribute("srcset") ?? "").split(",").map((candidate) => candidate.trim()).filter(Boolean);
      const addressIn = (candidate) => candidate.split(/\s+/)[0];
      /** The address an image shows: its own, or else the first in its srcset. */
      const addressOf = (image) => (image.getAttribute("src") ?? "").trim() || addressIn(candidates(image)[0] ?? "");
      /** Keeps only the candidates in an element's srcset that load at once, and says how many. */
      const keepLoadable = (element) => {
        const all = candidates(element);
        const kept = all.filter((candidate) => loadsAtOnce(addressIn(candidate)));
        if (kept.length === all.length) return kept.length;
        if (kept.length > 0) element.setAttribute("srcset", kept.join(", "));
        else element.removeAttribute("srcset");
        return kept.length;
      };
      const pictureOf = (image) => (image.parentElement?.localName === "picture" ? image.parentElement : null);
      const action = (host, loading) =>
        (loading ? "Loading image" : "Load image") + (host ? ` from ${host}` : "") + (loading ? "…" : "");
      const icon =
        '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2"/>' +
        '<circle cx="10.5" cy="6.25" r="1.25"/><path d="M1.75 11.25 5.5 7.5l3.75 3.75 1.5-1.5 3.5 3.5"/></svg>';

      /** Each placeholder, with the image it stands for. */
      const placeholders = new Map();
      const replace = (image) => {
        const src = addressOf(image);
        const url = resolve(src);
        const address = url?.href ?? src;
        const host = url?.host ?? "";
        const placeholder = document.createElement("button");
        placeholder.type = "button";
        placeholder.className = "media-placeholder";
        placeholder.dataset.image = address;
        placeholder.dataset.host = host;
        placeholder.innerHTML = icon;
        const text = document.createElement("span");
        text.className = "media-placeholder-text";
        const part = (name, said) => {
          const span = document.createElement("span");
          span.className = `media-placeholder-${name}`;
          span.dataset.part = name;
          span.textContent = said;
          text.append(span);
          return span;
        };
        const alt = (image.getAttribute("alt") ?? "").trim();
        if (alt && alt.toLowerCase() !== "image") part("name", alt);
        part("action", action(host, false));
        part("reason", "").hidden = true;
        placeholder.append(text);
        placeholder.addEventListener("click", (event) => {
          // Not the link around it, if any.
          event.preventDefault();
          event.stopPropagation();
          if (placeholder.dataset.state !== "loading") {
            window.webkit.messageHandlers.loadImage.postMessage(address);
          }
        });
        placeholders.set(placeholder, image);
        // A picture's sources would win over the image once it loads.
        (pictureOf(image) ?? image).replaceWith(placeholder);
      };
      for (const image of [...content.querySelectorAll("img")]) {
        const address = addressOf(image);
        if (address && !loadsAtOnce(address)) {
          if (image.classList.contains("emoji")) image.replaceWith(image.getAttribute("alt") ?? "");
          else replace(image);
          continue;
        }
        keepLoadable(image);
        for (const source of [...(pictureOf(image)?.children ?? [])]) {
          if (source.localName === "source" && keepLoadable(source) === 0) source.remove();
        }
      }

      /** Shows the image at an address as `loading`, `failed` or `loaded`. */
      window.verdandiShowImage = (address, state, value) => {
        for (const [placeholder, image] of placeholders) {
          if (placeholder.dataset.image !== address) continue;
          if (state === "loaded") {
            const loaded = document.createElement("img");
            for (const name of ["alt", "title", "width", "height", "align"]) {
              const kept = image.getAttribute(name);
              if (kept !== null) loaded.setAttribute(name, kept);
            }
            loaded.src = value;
            placeholder.replaceWith(loaded);
            placeholders.delete(placeholder);
            continue;
          }
          placeholder.dataset.state = state;
          placeholder.querySelector("[data-part=action]").textContent =
            action(placeholder.dataset.host, state === "loading");
          const reason = placeholder.querySelector("[data-part=reason]");
          reason.textContent = state === "failed" ? value : "";
          reason.hidden = state !== "failed";
        }
      };
      window.webkit.messageHandlers.placeholders.postMessage(
        [...new Set([...placeholders.keys()].map((placeholder) => placeholder.dataset.image))]);
    })();
    """#

  /// Reports the content's height whenever it changes, as images load,
  /// `<details>` open or the width changes. It runs in the app's own
  /// script world, which the content cannot reach.
  static let measureScript = """
    (() => {
      const content = document.getElementById("content");
      if (!content) return;
      let last = -1;
      const report = () => {
        const height = Math.ceil(content.getBoundingClientRect().height);
        if (height !== last) {
          last = height;
          window.webkit.messageHandlers.height.postMessage(height);
        }
      };
      for (const image of document.images) {
        image.loading = "eager";
        image.addEventListener("load", report);
        image.addEventListener("error", report);
      }
      new ResizeObserver(report).observe(content);
      report();
    })();
    """

  final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var parent: GitHubWebView?
    private(set) var html: String?
    private(set) var offset: CGFloat = 0
    /// Whether the web view is loading its own document, the one
    /// navigation it may make.
    private var loadingDocument = false
    /// The images from elsewhere the document shows placeholders for, each
    /// with its address as the document wrote it; none until it said.
    private var placeholders: [URL: String]?
    /// The state the document shows each of them in.
    private var shown: [URL: ThirdPartyImages.State] = [:]

    func load(_ html: String, offset: CGFloat, in view: WKWebView) {
      self.html = html
      self.offset = offset
      loadingDocument = true
      placeholders = nil
      shown = [:]
      view.loadHTMLString(GitHubHTMLDocument.wrap(html, offset: offset), baseURL: GitHubHTMLDocument.baseURL)
    }

    /// Shows the images from elsewhere that the document has placeholders
    /// for in their states, where they changed.
    func showImages(in view: WKWebView) {
      guard let placeholders, let images = parent?.images else { return }
      for (url, address) in placeholders {
        guard let state = images[url], shown[url] != state else { continue }
        shown[url] = state
        let (name, value) =
          switch state {
          case .loading: ("loading", "")
          case .loaded(let source): ("loaded", source)
          case .failed(let reason): ("failed", reason)
          }
        view.callAsyncJavaScript(
          "verdandiShowImage(address, state, value)", arguments: ["address": address, "state": name, "value": value],
          in: nil, in: .defaultClient, completionHandler: nil)
      }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
      switch message.name {
      case "height":
        guard let height = message.body as? NSNumber else { return }
        parent?.onHeight?(CGFloat(height.doubleValue))
      case "placeholders":
        guard let addresses = message.body as? [String], let view = message.webView else { return }
        let placeholders = Dictionary(
          addresses.compactMap { address in URL(string: address).map { ($0, address) } }, uniquingKeysWith: { a, _ in a })
        self.placeholders = placeholders
        showImages(in: view)
        if LaunchOptions.loadsImages {
          for url in placeholders.keys { parent?.onLoadImage(url) }
        }
      case "loadImage":
        guard let address = message.body as? String, let url = URL(string: address) else { return }
        parent?.onLoadImage(url)
      default:
        break
      }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
      let mainFrame = action.targetFrame?.isMainFrame == true
      if loadingDocument, action.navigationType == .other, mainFrame { return .allow }
      // A click, or Open Link from the context menu.
      if action.navigationType == .linkActivated || (action.navigationType == .other && mainFrame),
        let url = action.request.url
      {
        follow(url)
      }
      return .cancel
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
      loadingDocument = false
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
      loadingDocument = false
    }

    /// Links that would open a new window, e.g. `target="_blank"`.
    func webView(
      _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
      for action: WKNavigationAction, windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
      if let url = action.request.url { follow(url) }
      return nil
    }

    private func follow(_ url: URL) {
      // A link to a part of the same body, such as a footnote.
      if url.absoluteString.hasPrefix(GitHubHTMLDocument.baseURL.absoluteString + "#") { return }
      parent?.onLink(url)
    }
  }
}

/// A web view that leaves vertical scrolling to the page around it and
/// keeps only the context menu items that make sense for a body.
final class PageWebView: WKWebView {
  override func scrollWheel(with event: NSEvent) {
    // Code blocks and tables may scroll sideways; the page scrolls the rest.
    if abs(event.scrollingDeltaX) > abs(event.scrollingDeltaY) {
      super.scrollWheel(with: event)
    } else {
      nextResponder?.scrollWheel(with: event)
    }
  }

  override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
    let unwanted: Set<String> = [
      "WKMenuItemIdentifierReload", "WKMenuItemIdentifierGoBack", "WKMenuItemIdentifierGoForward",
      "WKMenuItemIdentifierOpenLinkInNewWindow", "WKMenuItemIdentifierDownloadLinkedFile",
      "WKMenuItemIdentifierOpenImageInNewWindow", "WKMenuItemIdentifierDownloadImage",
      "WKMenuItemIdentifierOpenMediaInNewWindow", "WKMenuItemIdentifierDownloadMedia",
      "WKMenuItemIdentifierInspectElement",
    ]
    for item in menu.items where unwanted.contains(item.identifier?.rawValue ?? "") {
      menu.removeItem(item)
    }
    super.willOpenMenu(menu, with: event)
  }
}

/// The document a body shows in: GitHub's HTML in a page with Verdandi's
/// stylesheet and a policy that lets nothing load but images and videos
/// from GitHub's media hosts.
enum GitHubHTMLDocument {
  /// Where relative links in bodies lead.
  static let baseURL = URL(string: "https://github.com/")!

  /// GitHub's hosts that the images and videos of bodies load from at once
  /// (ADR 0003): uploads, signed or legacy, avatars, and images from
  /// elsewhere through GitHub's Camo proxy. An image from any other host
  /// loads only once the user asks.
  static let mediaHosts = [
    "camo.githubusercontent.com", "private-user-images.githubusercontent.com", "user-images.githubusercontent.com",
    "avatars.githubusercontent.com",
  ]

  /// `mediaHosts` as a JavaScript array.
  static var mediaHostsJSON: String {
    "[" + mediaHosts.map { "\"\($0)\"" }.joined(separator: ", ") + "]"
  }

  /// What the document may load: images and videos from `mediaHosts`,
  /// images from `data:` addresses, as a loaded image from elsewhere shows,
  /// and its inline styles. Nothing else, scripts included.
  static var policy: String {
    let hosts = mediaHosts.map { "https://\($0)" }.joined(separator: " ")
    return "default-src 'none'; img-src \(hosts) data:; media-src \(hosts); style-src 'unsafe-inline'"
  }

  /// The document of `html`, its content moved up by `offset` for a slice
  /// that shows a part further down.
  static func wrap(_ html: String, offset: CGFloat = 0) -> String {
    """
    <!doctype html>
    <html>
    <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="light dark">
    <meta http-equiv="Content-Security-Policy" content="\(policy)">
    <style>\(stylesheet)</style>
    </head>
    <body><div id="content" style="transform: translateY(-\(Int(offset))px)">\(html)</div></body>
    </html>
    """
  }

  /// A compact stylesheet after github.com's, in the system's font and
  /// colours.
  static let stylesheet = """
    :root {
      --text: rgba(0, 0, 0, 0.85);
      --secondary: rgba(0, 0, 0, 0.5);
      --separator: rgba(0, 0, 0, 0.1);
      --fill: rgba(0, 0, 0, 0.045);
      --fill-strong: rgba(0, 0, 0, 0.08);
      --link: #0a66d8;
      --note: #0969da; --tip: #1a7f37; --important: #8250df; --warning: #9a6700; --caution: #d1242f;
      --pl-c: #6e7781; --pl-c1: #0550ae; --pl-e: #6639ba; --pl-ent: #116329; --pl-k: #cf222e;
      --pl-s: #0a3069; --pl-v: #953800; --pl-bu: #82071e; --pl-sr: #116329;
      --pl-md: #82071e; --pl-md-bg: #ffebe9; --pl-mi1: #116329; --pl-mi1-bg: #dafbe1;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --text: rgba(255, 255, 255, 0.86);
        --secondary: rgba(255, 255, 255, 0.55);
        --separator: rgba(255, 255, 255, 0.12);
        --fill: rgba(255, 255, 255, 0.06);
        --fill-strong: rgba(255, 255, 255, 0.1);
        --link: #4aa0ff;
        --note: #4493f8; --tip: #3fb950; --important: #ab7df8; --warning: #d29922; --caution: #f85149;
        --pl-c: #8b949e; --pl-c1: #79c0ff; --pl-e: #d2a8ff; --pl-ent: #7ee787; --pl-k: #ff7b72;
        --pl-s: #a5d6ff; --pl-v: #ffa657; --pl-bu: #f85149; --pl-sr: #7ee787;
        --pl-md: #ffdcd7; --pl-md-bg: #67060c; --pl-mi1: #aff5b4; --pl-mi1-bg: #033a16;
      }
    }
    @supports (color: -apple-system-label) {
      :root {
        --text: -apple-system-label;
        --secondary: -apple-system-secondary-label;
        --separator: -apple-system-separator;
      }
    }
    @supports (color: -apple-system-control-accent) {
      :root { --link: -apple-system-control-accent; }
    }
    html, body {
      margin: 0; padding: 0; overflow: hidden; background: transparent;
      color: var(--text);
      font: 13px/1.55 -apple-system, system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
      word-wrap: break-word;
    }
    #content { display: flow-root; }
    #content > :first-child { margin-top: 0 !important; }
    #content > :last-child { margin-bottom: 0 !important; }
    p, ul, ol, blockquote, pre, table, details, dl, .highlight, .markdown-alert { margin: 0 0 10px; }
    h1, h2, h3, h4, h5, h6 { margin: 20px 0 8px; font-weight: 600; line-height: 1.25; }
    h1 { font-size: 1.6em; } h2 { font-size: 1.35em; } h3 { font-size: 1.15em; }
    h4 { font-size: 1em; } h5 { font-size: 0.9em; } h6 { font-size: 0.85em; color: var(--secondary); }
    h1, h2 { padding-bottom: 6px; border-bottom: 1px solid var(--separator); }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }
    a.user-mention, a.team-mention { font-weight: 600; color: var(--text); }
    strong, b { font-weight: 600; }
    hr { height: 1px; border: 0; background: var(--separator); margin: 18px 0; }
    ul, ol { padding-left: 22px; }
    li + li, li > ul, li > ol { margin-top: 3px; }
    li > ul, li > ol { margin-bottom: 0; }
    li > p { margin: 4px 0; }
    ul.contains-task-list { padding-left: 0; list-style: none; }
    ul.contains-task-list ul.contains-task-list { padding-left: 22px; }
    li.task-list-item { list-style: none; position: relative; padding-left: 22px; }
    li.task-list-item > input[type=checkbox], .task-list-item-checkbox {
      position: absolute; left: 0; top: 3px; margin: 0; width: 13px; height: 13px;
      accent-color: var(--link); opacity: 1;
    }
    code, kbd, samp, tt, pre {
      font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px;
    }
    :not(pre) > code, tt {
      padding: 1px 5px; border-radius: 5px; background: var(--fill-strong); white-space: break-spaces;
    }
    pre {
      padding: 10px 12px; border-radius: 8px; background: var(--fill); overflow-x: auto;
      line-height: 1.45; white-space: pre;
    }
    pre code { padding: 0; background: none; font-size: inherit; white-space: pre; }
    .highlight pre { margin: 0; }
    kbd {
      padding: 1px 5px; border: 1px solid var(--separator); border-bottom-width: 2px;
      border-radius: 5px; font-size: 11px;
    }
    blockquote { padding: 0 12px; color: var(--secondary); border-left: 3px solid var(--separator); }
    table { border-collapse: collapse; display: block; max-width: 100%; overflow-x: auto; width: max-content; }
    th, td { padding: 5px 10px; border: 1px solid var(--separator); }
    th { font-weight: 600; background: var(--fill); }
    tr:nth-child(2n) td { background: var(--fill); }
    img, video { max-width: 100%; height: auto; border-radius: 6px; box-sizing: border-box; }
    img[align=right] { padding-left: 16px; } img[align=left] { padding-right: 16px; }
    details { padding: 6px 10px; border-radius: 8px; background: var(--fill); }
    details > summary { cursor: default; font-weight: 500; }
    details[open] > summary { margin-bottom: 8px; }
    dl dt { font-weight: 600; margin-top: 8px; } dl dd { margin: 0 0 8px 16px; }
    sup, sub { line-height: 0; }
    .footnotes { font-size: 12px; color: var(--secondary); border-top: 1px solid var(--separator); padding-top: 8px; }
    .footnotes ol { padding-left: 18px; }
    .octicon { fill: currentColor; vertical-align: text-bottom; display: inline-block; overflow: visible; }
    .markdown-alert { padding: 6px 12px; border-left: 3px solid var(--alert); border-radius: 2px; }
    .markdown-alert > :last-child { margin-bottom: 0; }
    .markdown-alert-title { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--alert); margin-bottom: 4px; }
    .markdown-alert-note { --alert: var(--note); } .markdown-alert-tip { --alert: var(--tip); }
    .markdown-alert-important { --alert: var(--important); } .markdown-alert-warning { --alert: var(--warning); }
    .markdown-alert-caution { --alert: var(--caution); }
    .anchor, .zeroclipboard-container, clipboard-copy, .js-render-enrichment-loader,
    .render-viewer-error, .render-viewer-fatal, .render-viewer-invalid, .octospinner,
    .sr-only, .js-clipboard-copy, .flash { display: none !important; }
    .render-plaintext-hidden { display: block !important; }
    g-emoji { font-family: "Apple Color Emoji", sans-serif; }
    .pl-c, .pl-c span { color: var(--pl-c); }
    .pl-c1, .pl-s .pl-v, .pl-mh, .pl-mh .pl-en, .pl-ms { color: var(--pl-c1); }
    .pl-e, .pl-en, .pl-mdr { color: var(--pl-e); }
    .pl-smi, .pl-s .pl-s1 { color: var(--text); }
    .pl-ent, .pl-sr .pl-sre, .pl-sr .pl-cce { color: var(--pl-ent); }
    .pl-k, .pl-sra, .pl-sr .pl-sra { color: var(--pl-k); }
    .pl-s, .pl-pds, .pl-s .pl-pse .pl-s1, .pl-sr, .pl-sr .pl-cce, .pl-sr .pl-sre, .pl-sr .pl-sra { color: var(--pl-s); }
    .pl-v, .pl-smw, .pl-mc { color: var(--pl-v); }
    .pl-bu, .pl-ii, .pl-c2 { color: var(--pl-bu); }
    .pl-mi { font-style: italic; } .pl-mb { font-weight: 600; }
    .pl-md { color: var(--pl-md); background: var(--pl-md-bg); }
    .pl-mi1 { color: var(--pl-mi1); background: var(--pl-mi1-bg); }
    .media-placeholder {
      display: inline-flex; align-items: center; gap: 8px; max-width: 100%; box-sizing: border-box;
      margin: 0; padding: 6px 12px 6px 10px; vertical-align: middle;
      font: inherit; color: var(--text); text-align: left;
      background: var(--fill); border: 1px dashed var(--separator); border-radius: 8px;
      appearance: none; cursor: default;
    }
    .media-placeholder:hover { background: var(--fill-strong); }
    .media-placeholder:focus-visible { outline: 2px solid var(--link); outline-offset: 1px; }
    .media-placeholder svg {
      flex: none; width: 16px; height: 16px; fill: none; stroke: var(--secondary); stroke-width: 1.25;
      stroke-linejoin: round; stroke-linecap: round;
    }
    .media-placeholder-text { display: flex; flex-direction: column; min-width: 0; }
    .media-placeholder-name { overflow-wrap: anywhere; }
    .media-placeholder-action { color: var(--link); }
    .media-placeholder[data-state=loading] .media-placeholder-action { color: var(--secondary); }
    .media-placeholder-reason { font-size: 12px; color: var(--caution); }
    """
}
