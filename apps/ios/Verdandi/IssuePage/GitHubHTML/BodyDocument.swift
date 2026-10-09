import SwiftUI
import VerdandiKit
import WebKit
import os

/// The document a body's web view shows: an empty page with the
/// stylesheet, a policy that lets nothing load but GitHub's media, and the
/// script that shows a body in it, which runs in the app's own script world
/// (`github-html.js`). Every web view loads it once, and shows one body
/// after another in it.
enum BodyDocument {
    static let log = Logger(subsystem: "io.github.chris-metz.verdandi", category: "bodies")

    /// The script world the app's script runs in, which the page cannot
    /// reach: the page runs no script of its own.
    static let world = WKContentWorld.world(name: "verdandi-body")

    /// The name the script sends its messages to.
    static let messageHandler = "body"

    /// The page, without a body yet.
    static let page: String = """
        <!doctype html>
        <html>
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
        <meta http-equiv="Content-Security-Policy" content="\(BodyMedia.contentSecurityPolicy)">
        <meta name="referrer" content="no-referrer">
        <meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
        <style>\(resource("github-markdown", "css"))</style>
        <style id="look"></style>
        </head>
        <body><div id="content" class="markdown-body"></div></body>
        </html>
        """

    /// The app's script, which sanitizes and follows a body.
    static let script = resource("github-html", "js")

    private static func resource(_ name: String, _ type: String) -> String {
        guard let url = Bundle.main.url(forResource: name, withExtension: type),
            let text = try? String(contentsOf: url, encoding: .utf8)
        else {
            log.fault("The app's \(name, privacy: .public).\(type, privacy: .public) is missing.")
            return ""
        }
        return text
    }

    /// The look a body shows in: the theme's colours, as CSS custom
    /// properties named as its tokens, the Dynamic Type body size, and
    /// light or dark controls.
    static func look(_ palette: Palette, textSize: CGFloat) -> String {
        let scheme = palette.theme?.kind == .dark ? "dark" : "light"
        let size = (textSize * 100).rounded() / 100
        return ":root { \(palette.cssVariables) --text-size: \(size)px; color-scheme: \(scheme); }"
    }
}
