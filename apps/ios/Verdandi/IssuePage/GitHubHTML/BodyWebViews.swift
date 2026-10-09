import UIKit
import VerdandiKit
import WebKit

/// A web view that shows bodies, one after another: as tall as its body,
/// it leaves scrolling to the page around it, but for code and tables that
/// scroll sideways within it.
final class BodyWKWebView: WKWebView {
    /// The body it shows now, if any.
    weak var coordinator: BodyWebView.Coordinator?
    /// Whether its page and the app's script in it have loaded.
    var isReady = false
    /// Whether it is loading its page, the one navigation it may make.
    var isLoadingPage = false

    /// It sits within the page, never at the screen's edges.
    override var safeAreaInsets: UIEdgeInsets { .zero }

    override func layoutSubviews() {
        super.layoutSubviews()
        coordinator?.didLayout()
    }

    /// The scroll view the page scrolls in, around the web view.
    var enclosingScrollView: UIScrollView? {
        var view = superview
        while let current = view {
            if let scrollView = current as? UIScrollView { return scrollView }
            view = current.superview
        }
        return nil
    }

    /// The view controller to present over, e.g. the image viewer.
    var presenter: UIViewController? {
        var responder: UIResponder? = self
        while let current = responder {
            if let controller = current as? UIViewController {
                var top = controller
                while let presented = top.presentedViewController, !presented.isBeingDismissed { top = presented }
                return top
            }
            responder = current.next
        }
        return nil
    }
}

/// The web views bodies show in, and what they share: one configuration, a
/// data store kept in memory only, the app's script, and a few web views
/// kept for the next bodies, so that a page with dozens of comments does
/// not start a web process for each as it scrolls. It answers every web
/// view's script, navigation and menus, for the body it shows.
@MainActor
final class BodyWebViews: NSObject {
    static let shared = BodyWebViews()

    /// How many web views wait for bodies to show, each with its process.
    private static let idleLimit = 4

    private var idle: [BodyWKWebView] = []

    override init() {
        super.init()
        // Low on memory, the waiting web views and their processes go.
        NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.idle.removeAll() }
        }
    }

    private lazy var configuration: WKWebViewConfiguration = {
        let configuration = WKWebViewConfiguration()
        // Nothing a body loads stays on disk, and no cookies reach it.
        configuration.websiteDataStore = .nonPersistent()
        // The page runs no script of its own; the app's runs in its own world.
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.preferences.isFraudulentWebsiteWarningEnabled = false
        configuration.preferences.isElementFullscreenEnabled = false
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsPictureInPictureMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.dataDetectorTypes = []
        configuration.suppressesIncrementalRendering = false
        let scripts = WKUserContentController()
        scripts.addUserScript(
            WKUserScript(
                source: BodyDocument.script, injectionTime: .atDocumentEnd, forMainFrameOnly: true,
                in: BodyDocument.world))
        scripts.addScriptMessageHandler(self, contentWorld: BodyDocument.world, name: BodyDocument.messageHandler)
        configuration.userContentController = scripts
        return configuration
    }()

    /// A web view for a body: one that waits, or a new one.
    func take() -> BodyWKWebView {
        if let view = idle.popLast() { return view }
        let view = BodyWKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.underPageBackgroundColor = .clear
        view.allowsBackForwardNavigationGestures = false
        view.allowsLinkPreview = true
        view.navigationDelegate = self
        view.uiDelegate = self
        let scrollView = view.scrollView
        scrollView.isScrollEnabled = false
        scrollView.scrollsToTop = false
        scrollView.bounces = false
        scrollView.showsVerticalScrollIndicator = false
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.minimumZoomScale = 1
        scrollView.maximumZoomScale = 1
        scrollView.pinchGestureRecognizer?.isEnabled = false
        scrollView.backgroundColor = .clear
        #if DEBUG
            view.isInspectable = true
        #endif
        load(view)
        return view
    }

    /// Takes back a web view whose body no longer shows, to show another,
    /// unless enough wait already.
    func recycle(_ view: BodyWKWebView) {
        view.coordinator = nil
        guard view.isReady, idle.count < Self.idleLimit, !idle.contains(view) else { return }
        view.callAsyncJavaScript("verdandi.clear()", in: nil, in: BodyDocument.world, completionHandler: nil)
        idle.append(view)
    }

    private func load(_ view: BodyWKWebView) {
        view.isReady = false
        view.isLoadingPage = true
        view.loadHTMLString(BodyDocument.page, baseURL: nil)
    }
}

extension BodyWebViews: WKScriptMessageHandlerWithReply {
    /// What the app's script sends: that it is ready, what it logs, and what
    /// the body it shows asks, which its coordinator answers.
    func userContentController(
        _ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        guard let view = message.webView as? BodyWKWebView, let body = message.body as? [String: Any],
            let kind = body["kind"] as? String
        else {
            replyHandler(nil, nil)
            return
        }
        switch kind {
        case "ready":
            view.isReady = true
            view.coordinator?.didBecomeReady()
            replyHandler(nil, nil)
        case "log":
            let text = body["message"] as? String ?? ""
            BodyDocument.log.error("A body's script failed: \(text, privacy: .public)")
            replyHandler(nil, nil)
        default:
            guard let coordinator = view.coordinator else {
                replyHandler(nil, nil)
                return
            }
            Task {
                let answer = await coordinator.answer(kind, body)
                replyHandler(answer, nil)
            }
        }
    }
}

extension BodyWebViews: WKNavigationDelegate {
    /// A web view loads its page, and nothing else: a link that would lead
    /// elsewhere goes to the body's coordinator, to follow as a tap does.
    func webView(
        _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
        let view = webView as? BodyWKWebView
        if view?.isLoadingPage == true, action.targetFrame?.isMainFrame == true, action.navigationType == .other,
            action.request.url?.absoluteString == "about:blank"
        {
            decisionHandler(.allow)
            return
        }
        if action.navigationType == .linkActivated, let url = action.request.url {
            view?.coordinator?.follow(url.absoluteString)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        (webView as? BodyWKWebView)?.isLoadingPage = false
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
        pageFailed(webView, error)
    }

    func webView(
        _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error
    ) {
        pageFailed(webView, error)
    }

    /// The page could not load, as when the system could not start a web
    /// process: it loads again a moment later, while a body waits for it.
    private func pageFailed(_ webView: WKWebView, _ error: any Error) {
        guard let view = webView as? BodyWKWebView, view.isLoadingPage else { return }
        view.isLoadingPage = false
        BodyDocument.log.error("A body's page could not load: \(error.localizedDescription, privacy: .public)")
        idle.removeAll { $0 === view }
        Task { [weak self, weak view] in
            try? await Task.sleep(for: .seconds(1))
            guard let self, let view, view.coordinator != nil, !view.isReady else { return }
            load(view)
        }
    }

    /// The system ended a web view's process, as it does for memory: its
    /// page loads again, and shows its body again once it has.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard let view = webView as? BodyWKWebView else { return }
        idle.removeAll { $0 === view }
        guard view.coordinator != nil else { return }
        view.coordinator?.didLoseContent()
        load(view)
    }
}

extension BodyWebViews: WKUIDelegate {
    /// A link that would open a window, which none does: nothing opens.
    func webView(
        _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        nil
    }

    /// A link's menu, as a long press shows it: what a tap does, the
    /// browser, and copying or sharing its address. Anything else has
    /// none, so that an image offers nothing the app cannot do.
    func webView(
        _ webView: WKWebView, contextMenuConfigurationForElement elementInfo: WKContextMenuElementInfo,
        completionHandler: @escaping @MainActor @Sendable (UIContextMenuConfiguration?) -> Void
    ) {
        guard let url = elementInfo.linkURL, let coordinator = (webView as? BodyWKWebView)?.coordinator else {
            completionHandler(nil)
            return
        }
        completionHandler(coordinator.menu(for: url))
    }

    /// A tap on a link's preview follows the link.
    func webView(
        _ webView: WKWebView, contextMenuForElement elementInfo: WKContextMenuElementInfo,
        willCommitWithAnimator animator: any UIContextMenuInteractionCommitAnimating
    ) {
        guard let url = elementInfo.linkURL, let coordinator = (webView as? BodyWKWebView)?.coordinator else {
            return
        }
        animator.addCompletion { coordinator.follow(url.absoluteString) }
    }
}
