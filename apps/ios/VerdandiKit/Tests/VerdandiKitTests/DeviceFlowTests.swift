import Foundation
import Synchronization
import Testing

@testable import VerdandiKit

/// github.com for the device flow: each form posted answered in turn, and
/// kept.
private final class FakeGitHubLogin: Sendable {
    let answers: Mutex<[(status: Int, body: String)]>
    let forms = Mutex<[(url: URL, form: [String: String])]>([])

    init(_ answers: [(status: Int, body: String)]) {
        self.answers = Mutex(answers)
    }

    var post: DeviceFlow.Post {
        { url, form in
            self.forms.withLock { $0.append((url, Dictionary(form, uniquingKeysWith: { $1 }))) }
            let answer: (status: Int, body: String) = self.answers.withLock { $0.isEmpty ? (500, "") : $0.removeFirst() }
            return (answer.status, Data(answer.body.utf8))
        }
    }
}

private let start = Date(timeIntervalSince1970: 1_000_000)

private let code = DeviceCode(
    deviceCode: "3584d83530557fdd1f46af8289938c8ef79f9dc5", userCode: "WDJB-MJHT",
    verificationURI: URL(string: "https://github.com/login/device")!, expiresAt: start.addingTimeInterval(900),
    interval: 5)

/// The waits a flow skipped, in seconds.
private final class Waits: Sendable {
    private let seconds = Mutex<[Int]>([])
    func add(_ wait: Int) { seconds.withLock { $0.append(wait) } }
    var all: [Int] { seconds.withLock { $0 } }
}

/// A flow that never waits, and whose clock moves by the waits it skipped.
private func flow(_ github: FakeGitHubLogin, clientID: String = "Iv1.abc") -> (DeviceFlow, Waits) {
    let waits = Waits()
    let flow = DeviceFlow(
        clientID: clientID, post: github.post,
        sleep: { seconds in waits.add(seconds) },
        now: { start.addingTimeInterval(TimeInterval(waits.all.reduce(0, +))) })
    return (flow, waits)
}

@Suite struct SigningInWithGitHubsDeviceFlow {
    @Test func asksForACodeWithTheAppsClientIDAndScopes() async throws {
        let github = FakeGitHubLogin([
            (
                200,
                #"{"device_code":"3584d83530557fdd1f46af8289938c8ef79f9dc5","user_code":"WDJB-MJHT","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}"#
            )
        ])
        let (flow, _) = flow(github)
        let requested = try await flow.requestCode()
        #expect(requested == code)
        let sent = try #require(github.forms.withLock { $0.first })
        #expect(sent.url.absoluteString == "https://github.com/login/device/code")
        #expect(sent.form == ["client_id": "Iv1.abc", "scope": "repo read:org"])
    }

    @Test func saysGitHubDoesNotKnowAClientIDItAnswersNotFoundFor() async {
        let (flow, _) = flow(FakeGitHubLogin([(404, #"{"error":"Not Found"}"#)]))
        await #expect(throws: DeviceFlowError.unknownClient) { try await flow.requestCode() }
    }

    @Test func saysWhenTheAppHasTheDeviceFlowTurnedOff() async {
        let (flow, _) = flow(
            FakeGitHubLogin([(400, #"{"error":"device_flow_disabled","error_description":"Device Flow must be explicitly enabled for this App"}"#)]))
        await #expect(throws: DeviceFlowError.disabled) { try await flow.requestCode() }
    }

    @Test func asksAtTheIntervalUntilTheUserAuthorizesTheApp() async throws {
        let github = FakeGitHubLogin([
            (200, #"{"error":"authorization_pending","error_description":"The authorization request is still pending."}"#),
            (200, #"{"error":"authorization_pending"}"#),
            (200, #"{"access_token":"gho_16C7e42F292c6912E7710c838347Ae178B4a","token_type":"bearer","scope":"repo,read:org"}"#),
        ])
        let (flow, waits) = flow(github)
        let token = try await flow.token(for: code)
        #expect(token == "gho_16C7e42F292c6912E7710c838347Ae178B4a")
        #expect(waits.all == [5, 5, 5])
        let sent = github.forms.withLock { $0 }
        #expect(sent.count == 3)
        #expect(sent.first?.url.absoluteString == "https://github.com/login/oauth/access_token")
        #expect(
            sent.first?.form == [
                "client_id": "Iv1.abc", "device_code": code.deviceCode,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            ])
    }

    @Test func waitsLongerWhenAskedToSlowDown() async throws {
        let github = FakeGitHubLogin([
            (200, #"{"error":"slow_down","interval":10}"#),
            (200, #"{"error":"slow_down"}"#),
            (200, #"{"access_token":"gho_x"}"#),
        ])
        let (flow, waits) = flow(github)
        #expect(try await flow.token(for: code) == "gho_x")
        #expect(waits.all == [5, 10, 15])
    }

    @Test func stopsWhenTheUserDeniesTheApp() async {
        let (flow, _) = flow(FakeGitHubLogin([(200, #"{"error":"access_denied"}"#)]))
        await #expect(throws: DeviceFlowError.denied) { try await flow.token(for: code) }
    }

    @Test func stopsWhenGitHubSaysTheCodeExpired() async {
        let (flow, _) = flow(FakeGitHubLogin([(200, #"{"error":"expired_token"}"#)]))
        await #expect(throws: DeviceFlowError.expired) { try await flow.token(for: code) }
    }

    @Test func stopsByItselfOnceTheCodeHasExpired() async {
        let github = FakeGitHubLogin(Array(repeating: (200, #"{"error":"authorization_pending"}"#), count: 500))
        let (flow, waits) = flow(github)
        await #expect(throws: DeviceFlowError.expired) { try await flow.token(for: code) }
        // 900 seconds at 5 each: the last wait ends as the code expires.
        #expect(waits.all.count == 180)
        #expect(github.forms.withLock { $0.count } == 179)
    }

    @Test func passesOnGitHubsWordsForAnyOtherError() async {
        let (flow, _) = flow(
            FakeGitHubLogin([(200, #"{"error":"incorrect_device_code","error_description":"The device_code provided is not valid."}"#)]))
        await #expect(throws: DeviceFlowError.failed("The device_code provided is not valid.")) {
            try await flow.token(for: code)
        }
    }

    @Test func saysWhenGitHubCannotBeReached() async {
        struct Offline: Error, LocalizedError { var errorDescription: String? { "The Internet connection appears to be offline." } }
        let flow = DeviceFlow(clientID: "Iv1.abc", post: { _, _ in throw Offline() }, sleep: { _ in })
        await #expect(throws: DeviceFlowError.unreachable("The Internet connection appears to be offline.")) {
            try await flow.requestCode()
        }
    }

    @Test func stopsAsItsTaskIsCancelled() async {
        let github = FakeGitHubLogin(Array(repeating: (200, #"{"error":"authorization_pending"}"#), count: 500))
        let flow = DeviceFlow(clientID: "Iv1.abc", post: github.post)
        let task = Task { try await flow.token(for: code) }
        task.cancel()
        await #expect(throws: CancellationError.self) { try await task.value }
    }

    @Test func encodesTheFormAsGitHubReadsIt() {
        #expect(DeviceFlow.formEncoded([("scope", "repo read:org"), ("a", "b&c=d")]) == "scope=repo%20read%3Aorg&a=b%26c%3Dd")
    }
}
