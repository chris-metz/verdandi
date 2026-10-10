import SwiftUI
import VerdandiKit

/// The images bodies show from elsewhere than GitHub's media hosts, each
/// loaded once the user asked, by its address (ADR 0003), as a `data:`
/// address that the bodies' policy lets show. One loaded stays so while
/// they fit `budget`, so that asking for it again, in another body or when
/// a page shows again, reads nothing again; past it, the ones loaded first
/// go, and show as placeholders again.
@MainActor
final class ThirdPartyImages {
    static let shared = ThirdPartyImages()

    enum Outcome: Sendable {
        case loaded(dataURL: String)
        case failed(String)
    }

    /// The characters of `data:` addresses kept at most: about 48 MB of
    /// images, a few of the largest an image may be.
    private let budget = 64 * 1024 * 1024

    /// The loads under way, which a second ask for the same image waits for.
    private var loads: [URL: Task<Outcome, Never>] = [:]

    /// The images loaded, as `data:` addresses by their own.
    private(set) var loaded: [String: String] = [:]
    /// Their addresses, loaded first first.
    private var order: [String] = []
    private var size = 0

    /// Loads the image at `url`, unless it is loaded or loading already.
    func load(_ url: URL) async -> Outcome {
        if let dataURL = loaded[url.absoluteString] { return .loaded(dataURL: dataURL) }
        let task =
            loads[url]
            ?? Task.detached {
                switch await ImageLoader().load(url) {
                case .loaded(let data, let type): .loaded(dataURL: "data:\(type);base64,\(data.base64EncodedString())")
                case .failed(let reason): .failed(reason)
                }
            }
        loads[url] = task
        let outcome = await task.value
        loads[url] = nil
        if case .loaded(let dataURL) = outcome { keep(dataURL, for: url.absoluteString) }
        return outcome
    }

    private func keep(_ dataURL: String, for address: String) {
        guard loaded[address] == nil else { return }
        loaded[address] = dataURL
        order.append(address)
        size += dataURL.utf8.count
        while size > budget, order.count > 1 {
            let oldest = order.removeFirst()
            size -= loaded.removeValue(forKey: oldest)?.utf8.count ?? 0
        }
    }
}

/// What the app remembers of each body while it runs, so that one shown
/// again, as the page scrolls back to it or is opened again, shows as it
/// was at once: its height at each width and text size, the images from
/// elsewhere the user loaded in it, and the `<details>` they opened.
@MainActor
enum BodyMemory {
    private static var heights: [String: CGFloat] = [:]
    private static var requested: [String: Set<String>] = [:]
    private static var openDetails: [String: [Int]] = [:]

    /// Each HTML's key, by the HTML's own hash, so that a page with dozens
    /// of comments drops no signatures again as it shows anew.
    private static var keys: [Int: Int] = [:]

    /// A body's HTML as heights are kept for it: without the signatures of
    /// its media links, which change on every read.
    static func key(_ html: String) -> Int {
        let hash = html.hashValue
        if let key = keys[hash] { return key }
        let key = SignedLinks.withoutSignatures(html).hashValue
        keys[hash] = key
        return key
    }

    private static func heightKey(_ bodyId: String, _ html: Int, _ width: CGFloat, _ textSize: CGFloat) -> String {
        "\(bodyId) \(html) \(Int(width.rounded())) \(Int((textSize * 10).rounded()))"
    }

    static func height(_ bodyId: String, html: Int, width: CGFloat, textSize: CGFloat) -> CGFloat? {
        heights[heightKey(bodyId, html, width, textSize)]
    }

    static func remember(
        height: CGFloat, of bodyId: String, html: Int, width: CGFloat, textSize: CGFloat
    ) {
        heights[heightKey(bodyId, html, width, textSize)] = height
    }

    /// The images from elsewhere that show at once in a body, as `data:`
    /// addresses by their own.
    static func loadedImages(in bodyId: String) -> [String: String] {
        let loaded = ThirdPartyImages.shared.loaded
        return (requested[bodyId] ?? []).reduce(into: [:]) { images, address in
            images[address] = loaded[address]
        }
    }

    static func requestImage(_ address: String, in bodyId: String) {
        requested[bodyId, default: []].insert(address)
    }

    static func openDetails(in bodyId: String) -> [Int] { openDetails[bodyId] ?? [] }

    static func remember(openDetails open: [Int], in bodyId: String) { openDetails[bodyId] = open }
}
