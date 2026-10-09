import Foundation

/// Where the images and videos of issue bodies load from (ADR 0003), as the
/// desktop app's renderer has it (`media.ts`): a body's web view loads them
/// itself, but only from GitHub's media hosts, which its Content Security
/// Policy names too: uploads, signed or legacy, and images from elsewhere
/// through GitHub's Camo proxy. Anything else never loads on its own.
public enum BodyMedia {
    /// GitHub's hosts that images load from, as the policy's `img-src`
    /// names them.
    public static let imageHosts = [
        "private-user-images.githubusercontent.com",
        "user-images.githubusercontent.com",
        "camo.githubusercontent.com",
    ]

    /// GitHub's hosts that videos load from, as the policy's `media-src`
    /// names them: uploads only, as Camo proxies no videos.
    public static let videoHosts = [
        "private-user-images.githubusercontent.com",
        "user-images.githubusercontent.com",
    ]

    /// What a body's document may load: images and videos from GitHub's
    /// media hosts, images from `data:` addresses, as an image loaded from
    /// elsewhere once asked shows, and its own inline styles. Nothing else,
    /// scripts included.
    public static var contentSecurityPolicy: String {
        let images = imageHosts.map { "https://\($0)" }.joined(separator: " ")
        let videos = videoHosts.map { "https://\($0)" }.joined(separator: " ")
        return "default-src 'none'; script-src 'none'; img-src \(images) data:; media-src \(videos); "
            + "style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"
    }

    public enum Kind: Sendable { case image, video }

    /// Where an image or video in a body loads from.
    public enum Source: Equatable, Sendable {
        /// One of GitHub's media hosts, at once.
        case github(URL)
        /// Another `https://` address, only once the user asks.
        case thirdParty(URL)
        /// Nowhere, e.g. an address of another scheme.
        case none
    }

    /// Where an image or video loads from, by its `src`, which is relative to
    /// github.com unless GitHub made it absolute, as it does its own.
    public static func source(_ kind: Kind, src: String) -> Source {
        let trimmed = src.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let base = URL(string: "https://github.com/"),
            let url = URL(string: trimmed, relativeTo: base)?.absoluteURL,
            url.scheme?.lowercased() == "https", url.user() == nil, url.password() == nil,
            let host = url.host()?.lowercased()
        else { return .none }
        let hosts = kind == .image ? imageHosts : videoHosts
        if hosts.contains(host), url.port == nil { return .github(url) }
        return kind == .image ? .thirdParty(url) : .none
    }
}

/// GitHub's links to uploaded images and videos, as it signs them anew in
/// every answer (`packages/core/src/signed-links.ts`): the same address,
/// with another signature in its query string, which expires five minutes
/// later. Bodies tell such links apart by their address.
public enum SignedLinks {
    /// A signed link in GitHub's HTML, with its address before the
    /// signature, as the core matches it. (Made anew each time: a regex is
    /// not `Sendable`.)
    private static var signedLink: Regex<(Substring, Substring)> {
        /(https:\/\/private-user-images\.githubusercontent\.com\/[^\s"'<>?#]*)\?[^\s"'<>#]*/
    }

    /// GitHub's HTML without the signatures of its media links.
    public static func withoutSignatures(_ html: String) -> String {
        html.replacing(signedLink) { $0.output.1 }
    }

    /// Whether two bodies' HTML differ in no more than the signatures of
    /// their media links: the page is then shown as it is, rather than
    /// anew, so that a video plays on.
    public static func sameExceptSignatures(_ before: String, _ now: String) -> Bool {
        before == now || withoutSignatures(before) == withoutSignatures(now)
    }

    /// A link to an image or video without its signature, which stays the
    /// same however often GitHub signs it anew; any other link as it is.
    public static func unsigned(_ link: String) -> String {
        guard var components = URLComponents(string: link),
            components.host?.lowercased() == "private-user-images.githubusercontent.com"
        else { return link }
        components.query = nil
        components.fragment = nil
        return components.string ?? link
    }

    /// The link to an image or video that failed to load, as a body read
    /// again for fresh links has it: signed anew, if GitHub signs it, or as
    /// it was; none once the body no longer shows it.
    public static func freshLink(for failed: String, in html: String) -> String? {
        let address = unsigned(failed)
        guard address != failed else {
            let shown = html.contains(failed) || html.contains(failed.replacingOccurrences(of: "&", with: "&amp;"))
            return shown ? failed : nil
        }
        for match in html.matches(of: signedLink) {
            // Attributes in HTML spell `&` in a query as `&amp;`.
            let link = String(match.output.0).replacingOccurrences(of: "&amp;", with: "&")
            if unsigned(link) == address { return link }
        }
        return nil
    }
}
