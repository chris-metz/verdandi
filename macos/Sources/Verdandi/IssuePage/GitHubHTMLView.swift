import AppKit
import SwiftUI
import WebKit

/// HTML GitHub rendered for an issue's body or a comment, in a web view
/// styled like the rest of the page: system font, its colours in light and
/// dark, a transparent background. It is as tall as its content, so the
/// page scrolls as one, and its links are handed to `onLink` rather than
/// followed. Nothing in it runs: script from the content is off, and only
/// images and videos over https load.
///
/// A web view much taller than a few screens draws nothing, so a long body
/// shows in slices: web views one under the other, each showing its part.
struct GitHubHTMLView: View {
  var html: String
  /// The height measured before, to take its place at once.
  var knownHeight: CGFloat?
  var onLink: (URL) -> Void
  var onHeight: (CGFloat) -> Void = { _ in }

  @State private var height: CGFloat?

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
    return GitHubWebView(html: html, offset: offset, onLink: onLink, onHeight: report)
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
private struct GitHubWebView: NSViewRepresentable {
  var html: String
  var offset: CGFloat
  var onLink: (URL) -> Void
  /// Where the content's height goes, for the slice that measures it.
  var onHeight: ((CGFloat) -> Void)?

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeNSView(context: Context) -> PageWebView {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = Self.dataStore
    configuration.defaultWebpagePreferences.allowsContentJavaScript = false
    let scripts = WKUserContentController()
    scripts.addUserScript(
      WKUserScript(source: Self.measureScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .defaultClient))
    scripts.add(context.coordinator, contentWorld: .defaultClient, name: "height")
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
    view.navigationDelegate = context.coordinator
    view.uiDelegate = context.coordinator
    context.coordinator.parent = self
    context.coordinator.load(html, offset: offset, in: view)
    return view
  }

  func updateNSView(_ view: PageWebView, context: Context) {
    context.coordinator.parent = self
    if context.coordinator.html != html || context.coordinator.offset != offset {
      context.coordinator.load(html, offset: offset, in: view)
    }
  }

  static func dismantleNSView(_ view: PageWebView, coordinator: Coordinator) {
    view.configuration.userContentController.removeAllScriptMessageHandlers()
    view.navigationDelegate = nil
    view.uiDelegate = nil
  }

  /// One store for every body, kept in memory only: nothing a body loads
  /// stays on disk, and no GitHub cookies reach it.
  static let dataStore = WKWebsiteDataStore.nonPersistent()

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

    func load(_ html: String, offset: CGFloat, in view: WKWebView) {
      self.html = html
      self.offset = offset
      loadingDocument = true
      view.loadHTMLString(GitHubHTMLDocument.wrap(html, offset: offset), baseURL: GitHubHTMLDocument.baseURL)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
      guard message.name == "height", let height = message.body as? NSNumber else { return }
      parent?.onHeight?(CGFloat(height.doubleValue))
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
private final class PageWebView: WKWebView {
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
/// stylesheet and a policy that lets nothing but media load.
enum GitHubHTMLDocument {
  /// Where relative links in bodies lead.
  static let baseURL = URL(string: "https://github.com/")!

  /// The document of `html`, its content moved up by `offset` for a slice
  /// that shows a part further down.
  static func wrap(_ html: String, offset: CGFloat = 0) -> String {
    """
    <!doctype html>
    <html>
    <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="light dark">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; media-src https:; style-src 'unsafe-inline'">
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
    """
}
