import SwiftUI
import VerdandiKit

/// An issue's or a comment's body, as GitHub renders it to HTML: untrusted,
/// so it is shown sanitized, in a web view that runs none of its script and
/// loads nothing but GitHub's media (ADR 0003), styled like github.com in
/// the app's theme and the Dynamic Type body size. As tall as its content,
/// so that it scrolls with the page; only wide code and tables scroll
/// sideways within it.
///
/// A link to an issue opens its page in the app; a pull request, a mention
/// or any other link opens in the browser. An image opens full screen when
/// tapped, and one from elsewhere than GitHub loads only once its
/// placeholder is tapped. Images and videos whose signed links expired load
/// again with fresh links the core reads.
///
/// Its web view is made only as the body comes near the screen, and given
/// back as the body goes far from it, keeping its height: a page with
/// dozens of comments keeps a few web views, not one each.
struct BodyHTMLView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette
    @ScaledMetric(relativeTo: .body) private var textSize: CGFloat = 17

    /// GitHub's HTML for the body.
    var html: String
    /// The issue whose page shows it.
    var issueId: String
    /// The issue's ID for its body, or the comment's for a comment's.
    var bodyId: String

    /// The HTML shown: the body's, unless it changed only in the
    /// signatures of its media links, so that what shows stays as it is,
    /// videos playing on, while the page is read again.
    @State private var shown: String
    @State private var shownKey: Int
    @State private var width: CGFloat = 0
    /// The height last measured, and for which width, text size and HTML.
    @State private var measured: Measured?
    /// Whether the body has its web view, as it is near the screen.
    @State private var live = false
    /// Whether its web view has shown it, since it was made.
    @State private var rendered = false
    /// Whether that takes long enough to say the body is loading.
    @State private var slow = false
    /// A linked issue that could not be opened, and why.
    @State private var failure: LinkFailure?

    init(html: String, issueId: String, bodyId: String) {
        self.html = html
        self.issueId = issueId
        self.bodyId = bodyId
        _shown = State(initialValue: html)
        _shownKey = State(initialValue: BodyMemory.key(html))
    }

    private struct Measured: Equatable {
        var height: CGFloat
        var width: CGFloat
        var textSize: CGFloat
        var key: Int
    }

    private struct LinkFailure: Equatable {
        var link: IssueLink
        var problem: Problem
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if isEmpty {
                Text("No description provided.")
                    .italic()
                    .foregroundStyle(palette.muted)
            } else {
                Color.clear
                    .frame(maxWidth: .infinity)
                    .frame(height: height)
                    .overlay(alignment: .top) {
                        if live { webView }
                    }
                    .overlay(alignment: .topLeading) {
                        if live, slow, !rendered {
                            ProgressView()
                                .padding(.top, 4)
                                .accessibilityLabel("Loading the body")
                        }
                    }
                    .task(id: live) {
                        rendered = false
                        slow = false
                        guard live else { return }
                        try? await Task.sleep(for: .milliseconds(600))
                        slow = true
                    }
                    .onGeometryChange(for: CGFloat.self) { proxy in
                        proxy.size.width
                    } action: { width in
                        self.width = width
                    }
                    .onGeometryChange(for: Proximity.self) { proxy in
                        Proximity(size: proxy.size, visible: proxy.bounds(of: .scrollView))
                    } action: { proximity in
                        switch proximity {
                        case .near: live = true
                        case .far: live = false
                        case .around: break
                        }
                    }
            }
            if let failure {
                LinkFailureNotice(
                    link: failure.link, problem: failure.problem,
                    retry: { Task { await retry(failure.link) } })
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onChange(of: html) { _, html in
            guard !SignedLinks.sameExceptSignatures(shown, html) else { return }
            shown = html
            shownKey = BodyMemory.key(html)
        }
    }

    private var webView: some View {
        BodyWebView(
            html: displayed, look: BodyDocument.look(palette, textSize: textSize), tint: UIColor(palette.accent),
            loadedImages: BodyMemory.loadedImages(in: bodyId), openDetails: BodyMemory.openDetails(in: bodyId),
            loadsImages: model.launch.loadsImages, actions: actions,
            launch: bodyId == issueId ? BodyLaunch(scroll: model.launch.bodyScroll, tap: model.launch.bodyTap) : nil)
    }

    /// The HTML shown, or a file's in its place, as a launch for
    /// screenshots asks.
    private var displayed: String {
        if bodyId == issueId, let file = model.launch.bodyHTML { return file }
        return shown
    }

    private var isEmpty: Bool {
        displayed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: Height

    /// The body's height: as measured at this width and text size, as
    /// remembered from before, or as guessed from its length until it has
    /// laid out.
    private var height: CGFloat {
        if let measured, measured.width == width, measured.textSize == textSize, measured.key == key {
            return measured.height
        }
        if let remembered = BodyMemory.height(bodyId, html: key, width: width, textSize: textSize) {
            return remembered
        }
        return measured?.height ?? estimatedHeight
    }

    private var key: Int {
        bodyId == issueId && model.launch.bodyHTML != nil ? BodyMemory.key(displayed) : shownKey
    }

    /// A guess at the body's height from its length, about half of which is
    /// GitHub's markup.
    private var estimatedHeight: CGFloat {
        let line = textSize * 1.5
        guard width > 0 else { return line }
        let characters = CGFloat(displayed.utf8.count) * 0.45
        let perLine = max(10, width / (textSize * 0.52))
        return max(line, (characters / perLine).rounded(.up) * line)
    }

    private func measured(_ height: CGFloat) {
        let now = Measured(height: height, width: width, textSize: textSize, key: key)
        guard measured != now else { return }
        measured = now
        BodyMemory.remember(height: height, of: bodyId, html: key, width: width, textSize: textSize)
    }

    // MARK: What the body asks

    private var actions: BodyActions {
        BodyActions(
            heightChanged: { height in
                rendered = true
                measured(height)
            },
            detailsChanged: { open in BodyMemory.remember(openDetails: open, in: bodyId) },
            openIssue: { link in await open(link) },
            renewMedia: { await renewMedia() },
            loadImage: { url in
                // Only what the body shows as an image from elsewhere.
                guard case .thirdParty = BodyMedia.source(.image, src: url.absoluteString) else {
                    return .failed("Not an https:// address")
                }
                BodyMemory.requestImage(url.absoluteString, in: bodyId)
                return await ThirdPartyImages.shared.load(url)
            },
            fullImage: { src in await Self.fullImage(src, renew: { await renewMedia() }) },
            pageURL: pageURL)
    }

    /// Where the body is on github.com: the issue's page, or the comment
    /// on it.
    private var pageURL: URL? {
        let page = model.pages[issueId]
        let url =
            bodyId == issueId
            ? page?.issue?.url : page?.comments?.comments.first { $0.id == bodyId }?.url
        return url.flatMap(URL.init(string:))
    }

    /// Opens a linked issue's page over this one, once the core found it;
    /// answers with the page of a pull request, which Verdandi does not
    /// show, to open in the browser. One that could not be found says why
    /// below the body.
    private func open(_ link: IssueLink) async -> URL? {
        failure = nil
        guard let core = model.core else { return nil }
        do {
            switch try await core.lookUpIssue(link.repository, number: link.number) {
            case .found(let issue):
                model.openIssue(
                    IssueRoute(id: issue.id, reference: issue.reference, title: issue.title, url: issue.url),
                    fromPage: true)
                return nil
            case .pullRequest(let url):
                return URL(string: url)
            case .failed(let problem):
                // Dropped, as when GitHub is read as another account.
                if problem != .interrupted { failure = LinkFailure(link: link, problem: problem) }
                return nil
            }
        } catch {
            failure = LinkFailure(link: link, problem: .error(message: error.localizedDescription))
            return nil
        }
    }

    private func retry(_ link: IssueLink) async {
        if let url = await open(link) { await UIApplication.shared.open(url) }
    }

    private func renewMedia() async -> RenewedMediaLinks {
        guard let core = model.core else { return .failed(.interrupted) }
        do {
            return try await core.renewMediaLinks(issueId, bodyId: bodyId)
        } catch {
            return .failed(.error(message: error.localizedDescription))
        }
    }

    /// An image a body shows, at its full size: one loaded from elsewhere
    /// from its `data:` address, one from GitHub's media hosts loaded again,
    /// with a fresh link once its own has expired.
    private static func fullImage(_ src: String, renew: () async -> RenewedMediaLinks) async -> UIImage? {
        if src.hasPrefix("data:") {
            guard let comma = src.firstIndex(of: ","), src[..<comma].hasSuffix(";base64"),
                let data = Data(base64Encoded: String(src[src.index(after: comma)...]))
            else { return nil }
            return await decoded(data)
        }
        guard case .github(let url) = BodyMedia.source(.image, src: src) else { return nil }
        if case .loaded(let data, _) = await ImageLoader().load(url) { return await decoded(data) }
        // GitHub's signed links stop working five minutes after it signed them.
        guard SignedLinks.unsigned(src) != src, case .renewed(let html) = await renew(),
            let fresh = SignedLinks.freshLink(for: src, in: html),
            case .github(let freshURL) = BodyMedia.source(.image, src: fresh),
            case .loaded(let data, _) = await ImageLoader().load(freshURL)
        else { return nil }
        return await decoded(data)
    }

    private static func decoded(_ data: Data) async -> UIImage? {
        await Task.detached(priority: .userInitiated) { UIImage.decoded(from: data) }.value
    }
}

/// How far a body is from the part of the page on screen: near, within
/// half a screen's height, when its web view is made; far, more than a
/// screen and a quarter away, when it is given back; around, between, when
/// it stays as it is. Each web view has a process of its own, so that few
/// are kept beyond the screen.
nonisolated private enum Proximity: Equatable, Sendable {
    case near, around, far

    init(size: CGSize, visible: CGRect?) {
        // Outside a scroll view, it is on screen.
        guard let visible, visible.height > 0 else {
            self = .near
            return
        }
        let distance = max(0, visible.minY - size.height, -visible.maxY)
        if distance <= visible.height * 0.5 {
            self = .near
        } else if distance <= visible.height * 1.25 {
            self = .around
        } else {
            self = .far
        }
    }
}

/// Says why a linked issue could not be opened, below its body, with Retry
/// and Open on GitHub.
private struct LinkFailureNotice: View {
    @Environment(\.palette) private var palette
    var link: IssueLink
    var problem: Problem
    var retry: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "exclamationmark.triangle")
                .foregroundStyle(palette.warning)
            VStack(alignment: .leading, spacing: 4) {
                Text("Could not open \(link.reference)")
                    .font(.footnote.weight(.semibold))
                Text(problem.message)
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
                HStack(spacing: 16) {
                    Button("Retry", action: retry)
                    if let url = URL(string: "https://github.com/\(link.repository.nameWithOwner)/issues/\(link.number)") {
                        Link("Open on GitHub", destination: url)
                    }
                }
                .font(.footnote.weight(.medium))
                .buttonStyle(.borderless)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.warning.opacity(0.1), in: .rect(cornerRadius: 12))
    }
}
