import SafariServices
import SwiftUI
import VerdandiKit
import WebKit

/// What a body's web view asks of the issue page around it, which knows the
/// issue, the core and the app.
struct BodyActions {
    /// The body's height, in points, as it laid out.
    var heightChanged: (CGFloat) -> Void
    /// Which of its `<details>` are open, by their place in it.
    var detailsChanged: ([Int]) -> Void
    /// Opens a linked issue's page in the app, answering with a page to
    /// open in the browser instead, for a pull request.
    var openIssue: (IssueLink) async -> URL?
    /// Reads the body again for fresh links to its images and videos.
    var renewMedia: () async -> RenewedMediaLinks
    /// Loads an image from elsewhere than GitHub's media hosts, once asked.
    var loadImage: (URL) async -> ThirdPartyImages.Outcome
    /// An image the body shows, by its address, at its full size.
    var fullImage: (String) async -> UIImage?
    /// Where the body is on github.com.
    var pageURL: () -> URL?
}

/// A body in a web view, which SwiftUI sizes: as wide as it is offered, as
/// tall as `BodyHTMLView` says. It shows the body once its web view is
/// ready and as wide as it will be, so that it lays out once; it then shows
/// it anew only as its HTML changes, and restyles it as its look does.
struct BodyWebView: UIViewRepresentable {
    var html: String
    /// The theme's colours and the text size, as CSS.
    var look: String
    /// The colour of selected text and its handles.
    var tint: UIColor
    /// The images from elsewhere that show at once, as `data:` addresses
    /// by their own: those the user loaded before.
    var loadedImages: [String: String]
    var openDetails: [Int]
    /// Whether every image from elsewhere loads at once, as a launch for
    /// screenshots asks.
    var loadsImages: Bool
    var actions: BodyActions
    /// What a launch for screenshots does with the body once it shows.
    var launch: BodyLaunch?

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> BodyWKWebView {
        let view = BodyWebViews.shared.take()
        view.tintColor = tint
        context.coordinator.attach(view, parent: self)
        return view
    }

    func updateUIView(_ view: BodyWKWebView, context: Context) {
        if view.tintColor != tint { view.tintColor = tint }
        context.coordinator.update(self)
    }

    static func dismantleUIView(_ view: BodyWKWebView, coordinator: Coordinator) {
        coordinator.detach()
        BodyWebViews.shared.recycle(view)
    }

    @MainActor
    final class Coordinator {
        private var parent: BodyWebView?
        private(set) weak var view: BodyWKWebView?
        /// What the web view shows: none until it has shown it.
        private var shownHTML: String?
        private var shownLook: String?
        /// Whether the launch's actions were done, which happens once.
        private var launched = false

        func attach(_ view: BodyWKWebView, parent: BodyWebView) {
            self.view = view
            self.parent = parent
            shownHTML = nil
            shownLook = nil
            view.coordinator = self
            showIfNeeded()
        }

        func update(_ parent: BodyWebView) {
            self.parent = parent
            showIfNeeded()
        }

        func detach() {
            if view?.coordinator === self { view?.coordinator = nil }
            view = nil
            parent = nil
        }

        func didLayout() { showIfNeeded() }

        func didBecomeReady() {
            shownHTML = nil
            showIfNeeded()
        }

        /// The web view's process ended, and its body with it.
        func didLoseContent() {
            shownHTML = nil
        }

        /// Shows the body, or its new look, unless the web view shows it
        /// already, or cannot yet.
        private func showIfNeeded() {
            guard let view, let parent, view.isReady, view.bounds.width > 0 else { return }
            if shownHTML != parent.html {
                shownHTML = parent.html
                shownLook = parent.look
                let options: [String: Any] = [
                    "look": parent.look,
                    "imageHosts": BodyMedia.imageHosts,
                    "videoHosts": BodyMedia.videoHosts,
                    "loaded": parent.loadedImages,
                    "openDetails": parent.openDetails,
                    "loadImages": parent.loadsImages,
                ]
                run("verdandi.render(html, options)", ["html": parent.html, "options": options])
                if let launch = parent.launch, !launched {
                    launched = true
                    perform(launch)
                }
            } else if shownLook != parent.look {
                shownLook = parent.look
                run("verdandi.restyle(css)", ["css": parent.look])
            }
        }

        private func run(_ script: String, _ arguments: [String: Any]) {
            view?.callAsyncJavaScript(script, arguments: arguments, in: nil, in: BodyDocument.world) { result in
                if case .failure(let error) = result {
                    BodyDocument.log.error("A body could not be shown: \(error.localizedDescription, privacy: .public)")
                }
            }
        }

        // MARK: What the body asks

        /// Answers what the app's script in the web view asks, by its kind.
        func answer(_ kind: String, _ message: [String: Any]) async -> Any? {
            guard let parent else { return nil }
            switch kind {
            case "height":
                if let height = message["height"] as? Double { parent.actions.heightChanged(CGFloat(height)) }
            case "details":
                parent.actions.detailsChanged(message["open"] as? [Int] ?? [])
            case "link":
                if let href = message["href"] as? String { await open(href) }
            case "scrollTo":
                if let top = message["top"] as? Double { scroll(to: CGFloat(top)) }
            case "openOnGitHub":
                if let url = parent.actions.pageURL() { openInBrowser(url) }
            case "renew":
                switch await parent.actions.renewMedia() {
                case .renewed(let html): return ["status": "renewed", "html": html]
                case .failed(let problem): return ["status": "failed", "reason": Self.reason(problem)]
                }
            case "loadImage":
                guard let address = message["url"] as? String, let url = URL(string: address) else {
                    return ["status": "failed", "reason": "Not an https:// address"]
                }
                switch await parent.actions.loadImage(url) {
                case .loaded(let dataURL): return ["status": "loaded", "url": dataURL]
                case .failed(let reason): return ["status": "failed", "reason": reason]
                }
            case "viewImage":
                if let src = message["src"] as? String {
                    let rect = CGRect(
                        x: message["x"] as? Double ?? 0, y: message["y"] as? Double ?? 0,
                        width: message["width"] as? Double ?? 0, height: message["height"] as? Double ?? 0)
                    await view(src, alt: message["alt"] as? String ?? "", at: rect)
                }
            default:
                break
            }
            return nil
        }

        /// Why a body could not be read again, in a few words, as a
        /// placeholder says it.
        private static func reason(_ problem: Problem) -> String {
            switch problem {
            case .unreachable: "GitHub could not be reached"
            case .unavailable: "GitHub no longer shows it"
            case .interrupted, .error: "Could not be read again"
            }
        }

        // MARK: Links

        /// Follows a link as a tap on it does: an issue opens in the app,
        /// anything else on the web in the browser.
        func follow(_ href: String) {
            Task { await open(href) }
        }

        private func open(_ href: String) async {
            switch BodyLink(href: href) {
            case .issue(let link):
                if let url = await parent?.actions.openIssue(link) { openInBrowser(url) }
            case .external(let url):
                openInBrowser(url)
            case .anchor, .none:
                break
            }
        }

        /// Opens a page in the browser: one on github.com where the user is
        /// signed in, in GitHub's app if it is installed, or Safari; any
        /// other in Safari over the app, so that the issue stays where it is.
        private func openInBrowser(_ url: URL) {
            if BodyLink.isOnGitHub(url) {
                UIApplication.shared.open(url)
                return
            }
            guard let presenter = view?.presenter else {
                UIApplication.shared.open(url)
                return
            }
            let safari = SFSafariViewController(url: url)
            safari.dismissButtonStyle = .close
            presenter.present(safari, animated: true)
        }

        /// What a long press on a link offers: what a tap does, GitHub's
        /// page for an issue, and copying or sharing its address.
        func menu(for url: URL) -> UIContextMenuConfiguration {
            let href = url.absoluteString
            return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
                var open: [UIMenuElement] = []
                switch BodyLink(href: href) {
                case .issue(let issue):
                    open = [
                        UIAction(title: "Open \(issue.reference)", image: UIImage(systemName: "arrow.forward.circle")) {
                            _ in self?.follow(href)
                        },
                        UIAction(title: "Open on GitHub", image: UIImage(systemName: "safari")) { _ in
                            UIApplication.shared.open(url)
                        },
                    ]
                case .external:
                    open = [
                        UIAction(title: "Open Link", image: UIImage(systemName: "safari")) { _ in self?.follow(href) }
                    ]
                case .anchor, .none:
                    break
                }
                let copy = UIAction(title: "Copy Link", image: UIImage(systemName: "doc.on.doc")) { _ in
                    UIPasteboard.general.url = url
                }
                let share = UIAction(title: "Share…", image: UIImage(systemName: "square.and.arrow.up")) { _ in
                    self?.share(url)
                }
                return UIMenu(title: href, children: [UIMenu(options: .displayInline, children: open), copy, share])
            }
        }

        private func share(_ url: URL) {
            guard let view, let presenter = view.presenter else { return }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = view
            presenter.present(sheet, animated: true)
        }

        /// Scrolls the page around the body so that a point in the body,
        /// such as a footnote a link names, shows at its top.
        func scroll(to top: CGFloat) {
            guard let view, let scrollView = view.enclosingScrollView else { return }
            let point = view.convert(CGPoint(x: 0, y: top), to: scrollView)
            let insets = scrollView.adjustedContentInset
            let lowest = -insets.top
            let highest = max(lowest, scrollView.contentSize.height + insets.bottom - scrollView.bounds.height)
            let offset = min(max(point.y - insets.top - 12, lowest), highest)
            scrollView.setContentOffset(CGPoint(x: scrollView.contentOffset.x, y: offset), animated: true)
        }

        // MARK: Images

        /// Shows an image full screen: at once as the body shows it, then
        /// at its full size, once loaded.
        private func view(_ src: String, alt: String, at rect: CGRect) async {
            guard let view, let parent, let presenter = view.presenter else { return }
            var shown: UIImage?
            if rect.width > 0, rect.height > 0 {
                let configuration = WKSnapshotConfiguration()
                configuration.rect = rect
                configuration.afterScreenUpdates = false
                shown = try? await view.takeSnapshot(configuration: configuration)
            }
            let full = parent.actions.fullImage
            let viewer = ImageViewerController(image: shown, description: alt) { await full(src) }
            presenter.present(viewer, animated: true)
        }
    }
}
