import Foundation
import Testing

@testable import VerdandiKit

/// Where links in bodies lead, and where their media load from, as the
/// desktop app's tests have it (`link-target.test.ts`, `media.test.ts`).
@Suite struct BodyLinks {
    @Test(arguments: [
        "https://github.com/acme/api/issues/12",
        "https://github.com/acme/api/issues/12/",
        "https://github.com/acme/api/issues/12#issuecomment-3000000001",
        "https://github.com/acme/api/issues/12?reload=1",
        "https://GitHub.com/acme/api/issues/12",
        "https://www.github.com/acme/api/issues/12",
    ])
    func opensAnIssueInTheApp(href: String) {
        #expect(BodyLink(href: href) == .issue(IssueLink(repository: .init(owner: "acme", name: "api"), number: 12)))
    }

    @Test func opensAnIssueInARepositoryWithDotsAndDashesInItsName() {
        #expect(
            BodyLink(href: "https://github.com/octo-org/web.site_v2/issues/7")
                == .issue(IssueLink(repository: .init(owner: "octo-org", name: "web.site_v2"), number: 7)))
    }

    @Test(arguments: [
        "https://github.com/acme/api/pull/3",
        "https://github.com/acme/api/issues",
        "https://github.com/acme/api/issues/new",
        "https://github.com/acme/api/issues/12/timeline",
        "https://github.com/acme/api/issues/0",
        "https://github.com/octo-dev",
        "https://gist.github.com/acme/api/issues/12",
        "https://github.com.evil.example/acme/api/issues/12",
        "https://example.com/acme/api/issues/12",
    ])
    func opensAnyOtherHTTPSLinkInTheBrowser(href: String) throws {
        #expect(BodyLink(href: href) == .external(try #require(URL(string: href))))
    }

    @Test(arguments: [("#user-content-fn-1", "user-content-fn-1"), ("#steps", "steps")])
    func followsAnAnchorWithinTheBody(href: String, id: String) {
        #expect(BodyLink(href: href) == .anchor(id))
    }

    @Test(arguments: [
        "http://example.com",
        "mailto:octo@example.com",
        "javascript:alert(1)",
        "data:text/html,x",
        "file:///etc/passwd",
        "/acme/api",
        "not a link",
        "#",
        "",
    ])
    func neverOpensAnythingElse(href: String) {
        #expect(BodyLink(href: href) == .none)
    }

    @Test func tellsGitHubsPagesApart() throws {
        #expect(BodyLink.isOnGitHub(try #require(URL(string: "https://github.com/octo-dev"))))
        #expect(BodyLink.isOnGitHub(try #require(URL(string: "https://docs.github.com/en"))))
        #expect(!BodyLink.isOnGitHub(try #require(URL(string: "https://github.com.evil.example/x"))))
        #expect(!BodyLink.isOnGitHub(try #require(URL(string: "https://example.com/github.com"))))
    }
}

private let signed = "https://private-user-images.githubusercontent.com/1/2-3f2a.png?jwt=abc"
private let legacy = "https://user-images.githubusercontent.com/1/2-3f2a.png"
private let camo = "https://camo.githubusercontent.com/8f1a/68747470733a2f2f6578616d706c652e636f6d2f782e706e67"

@Suite struct BodyMediaSources {
    @Test(arguments: [signed, legacy, camo])
    func loadsAnImageFromGitHubsMediaHostsAtOnce(src: String) throws {
        #expect(BodyMedia.source(.image, src: src) == .github(try #require(URL(string: src))))
    }

    @Test(arguments: [
        "https://example.com/logo.png",
        "https://camo.githubusercontent.com.evil.example/x.png",
        "https://evil.example/?https://camo.githubusercontent.com/x",
        "https://camo.githubusercontent.com:8443/x.png",
        "https://avatars.githubusercontent.com/u/1",
        "https://raw.githubusercontent.com/acme/api/main/logo.png",
        "https://github.com/user-attachments/assets/3f2a",
    ])
    func loadsAnImageFromElsewhereOnlyOnceAsked(src: String) throws {
        #expect(BodyMedia.source(.image, src: src) == .thirdParty(try #require(URL(string: src))))
    }

    @Test func readsAnAddressRelativeToGitHubAsOneOnIt() throws {
        #expect(
            BodyMedia.source(.image, src: "/acme/api/raw/main/logo.png")
                == .thirdParty(try #require(URL(string: "https://github.com/acme/api/raw/main/logo.png"))))
    }

    @Test(arguments: [
        "http://camo.githubusercontent.com/x.png",
        "http://example.com/logo.png",
        "https://octo:secret@camo.githubusercontent.com/x.png",
        "https://octo@example.com/logo.png",
        "data:image/png;base64,iVBORw0KGgo=",
        "blob:https://github.com/3f2a",
        "javascript:alert(1)",
        "file:///etc/passwd",
        "https://[bad",
        "",
        " ",
    ])
    func neverLoadsAnImageFromAnythingElse(src: String) {
        #expect(BodyMedia.source(.image, src: src) == .none)
    }

    @Test func loadsVideosOnlyFromGitHubsHostsForUploads() throws {
        let video = signed.replacingOccurrences(of: ".png", with: ".mp4")
        #expect(BodyMedia.source(.video, src: video) == .github(try #require(URL(string: video))))
        for src in [camo, "https://example.com/demo.mp4", "http://example.com/x.mp4"] {
            #expect(BodyMedia.source(.video, src: src) == .none)
        }
    }

    @Test func letsTheDocumentLoadNothingButGitHubsMediaAndWhatTheAppLoaded() {
        let directives = Dictionary(
            uniqueKeysWithValues: BodyMedia.contentSecurityPolicy.split(separator: ";").map { directive in
                let words = directive.split(separator: " ").map(String.init)
                return (words[0], Set(words.dropFirst()))
            })
        #expect(directives["default-src"] == ["'none'"])
        #expect(directives["script-src"] == ["'none'"])
        #expect(
            directives["img-src"] == [
                "https://private-user-images.githubusercontent.com", "https://user-images.githubusercontent.com",
                "https://camo.githubusercontent.com", "data:",
            ])
        #expect(
            directives["media-src"] == [
                "https://private-user-images.githubusercontent.com", "https://user-images.githubusercontent.com",
            ])
    }
}

@Suite struct SignedMediaLinks {
    private func signedAs(_ signature: String) -> String {
        "https://private-user-images.githubusercontent.com/1/2-3f2a.png?jwt=\(signature)"
    }

    private func withImage(_ text: String, _ signature: String) -> String {
        #"<p dir="auto">\#(text) <img src="\#(signedAs(signature))" alt="Screenshot"></p>"#
    }

    @Test func tellsBodiesThatDifferOnlyInSignaturesApart() {
        #expect(SignedLinks.sameExceptSignatures(withImage("Crash", "a"), withImage("Crash", "b")))
        #expect(!SignedLinks.sameExceptSignatures(withImage("Crash", "a"), withImage("Crashed", "a")))
        #expect(!SignedLinks.sameExceptSignatures(#"<img src="\#(camo)?a">"#, #"<img src="\#(camo)?b">"#))
    }

    @Test func dropsOnlyTheSignatureOfAnUpload() {
        #expect(SignedLinks.unsigned(signedAs("a")) == "https://private-user-images.githubusercontent.com/1/2-3f2a.png")
        #expect(SignedLinks.unsigned(camo + "?a=1") == camo + "?a=1")
    }

    @Test func findsAFailedMediumsFreshLinkInItsBodyReadAgain() {
        #expect(SignedLinks.freshLink(for: signedAs("a"), in: withImage("Crash", "b")) == signedAs("b"))
        let video = signedAs("a").replacingOccurrences(of: ".png", with: ".mp4")
        let html = #"<video src="\#(signedAs("b&amp;v=2").replacingOccurrences(of: ".png", with: ".mp4"))"></video>"#
        #expect(
            SignedLinks.freshLink(for: video, in: html)
                == signedAs("b&v=2").replacingOccurrences(of: ".png", with: ".mp4"))
    }

    @Test func findsALinkGitHubNeverSignsAsItWas() {
        #expect(SignedLinks.freshLink(for: camo, in: #"<p><img src="\#(camo)" alt="Logo"></p>"#) == camo)
    }

    @Test func findsNoneForAMediumTheBodyNoLongerShows() {
        #expect(SignedLinks.freshLink(for: signedAs("a"), in: #"<p dir="auto">Fixed</p>"#) == nil)
        #expect(SignedLinks.freshLink(for: camo, in: #"<p dir="auto">Fixed</p>"#) == nil)
    }
}
