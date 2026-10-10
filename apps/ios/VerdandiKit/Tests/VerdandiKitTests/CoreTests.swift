import Foundation
import Synchronization
import Testing

@testable import VerdandiKit

/// GitHub for tests: each request answered by `answer`, and kept.
final class FakeGitHub: GitHubTransport {
    let answer: @Sendable (GitHubRequest) -> GitHubOutcome
    let source: TokenSource?
    let requests = Mutex<[GitHubRequest]>([])

    init(source: TokenSource? = .stored, answer: @escaping @Sendable (GitHubRequest) -> GitHubOutcome) {
        self.source = source
        self.answer = answer
    }

    func send(_ request: GitHubRequest) async -> GitHubOutcome {
        requests.withLock { $0.append(request) }
        return answer(request)
    }

    func tokenSource() -> TokenSource? { source }
}

func json(_ object: Any) -> String {
    String(decoding: try! JSONSerialization.data(withJSONObject: object), as: UTF8.self)
}

/// The bundle, as `scripts/test-kit.sh` builds it before the tests run.
func coreScript() throws -> String {
    let path =
        ProcessInfo.processInfo.environment["VERDANDI_CORE_JS"]
        ?? URL(filePath: #filePath).deletingLastPathComponent().appending(path: "../../../Verdandi/Resources/core.js")
        .standardized.path()
    return try String(contentsOfFile: path, encoding: .utf8)
}

func temporaryHome() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appending(path: "verdandi-tests-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

func startCore(home: URL, github: FakeGitHub) throws -> Core {
    try Core(
        script: try coreScript(),
        options: .init(home: home.path(), interfaceFont: "SF Pro", codeFont: "SF Mono", installedFonts: ["SF Pro", "SF Mono"]),
        github: github)
}

let signedIn: @Sendable (GitHubRequest) -> GitHubOutcome = { request in
    if request.path == "user" { return .response(status: 200, headers: [], body: json(["login": "octo-reader"])) }
    return .response(status: 404, headers: [], body: json(["message": "Not Found"]))
}

@Suite struct CoreOnJavaScriptCore {
    @Test func isReadyOnceGitHubNamesTheAccount() async throws {
        let core = try startCore(home: try temporaryHome(), github: FakeGitHub(answer: signedIn))

        let setup = try await core.checkSetupAgain()

        #expect(setup.account == Account(login: "octo-reader", host: "github.com"))
    }

    @Test func isBlockedWithoutAToken() async throws {
        let github = FakeGitHub(source: nil, answer: signedIn)
        let core = try startCore(home: try temporaryHome(), github: github)

        #expect(try await core.checkSetupAgain() == .blocked(.signedOut))
        #expect(github.requests.withLock { $0 }.isEmpty)
    }

    @Test func writesSettingsIntoItsHome() async throws {
        let home = try temporaryHome()
        let core = try startCore(home: home, github: FakeGitHub(answer: signedIn))

        guard case .read(let first) = try await core.getSidebar() else { Issue.record("unread"); return }
        let skipped = try await core.skipRepositoryPicker()
        guard case .read(let second) = try await core.getSidebar() else { Issue.record("unread"); return }

        #expect(first.firstLaunch)
        #expect(skipped.ok)
        #expect(!second.firstLaunch)
        let settings = try String(contentsOf: home.appending(path: "settings.json"), encoding: .utf8)
        #expect(settings.contains("\"repositories\": []"))
    }

    @Test func pushesConfigChanges() async throws {
        let home = try temporaryHome()
        let core = try startCore(home: home, github: FakeGitHub(answer: signedIn))

        let changed = try await core.changeConfig(ConfigChange(appearance: .dark))
        var events = core.events.makeAsyncIterator()
        var config: ConfigState?
        while config == nil, let event = await events.next() {
            if case .configChanged(let state) = event, state.config.appearance == .dark { config = state }
        }

        #expect(changed.ok)
        #expect(config?.config.appearance == .dark)
        let toml = try String(contentsOf: home.appending(path: "config.toml"), encoding: .utf8)
        #expect(toml.contains("appearance = \"dark\""))
    }

    @Test func keepsRecentIssues() async throws {
        let core = try startCore(home: try temporaryHome(), github: FakeGitHub(answer: signedIn))
        let issue = RecentIssue(id: "I_1", repository: .init(owner: "octo", name: "one"), number: 12, title: "Fly")

        try await core.recordRecentIssue(issue)

        #expect(try await core.getRecentIssues() == [issue])
    }

    @Test func waitsWithTimersAsTheCoreAsks() async throws {
        // A transient failure is retried after a second: only timers lead there.
        let attempts = Mutex(0)
        let github = FakeGitHub { request in
            if request.path == "user" { return signedIn(request) }
            let attempt = attempts.withLock { count in
                count += 1
                return count
            }
            if attempt == 1 { return .response(status: 502, headers: [], body: "") }
            return .response(status: 404, headers: [], body: json(["message": "Not Found"]))
        }
        let core = try startCore(home: try temporaryHome(), github: github)

        let lookup = try await core.lookUpIssue(.init(owner: "octo", name: "one"), number: 12)

        #expect(attempts.withLock { $0 } >= 2)
        if case .failed = lookup {} else { Issue.record("expected a failure, got \(lookup)") }
    }

    @Test func listsThemes() async throws {
        let core = try startCore(home: try temporaryHome(), github: FakeGitHub(answer: signedIn))

        let themes = await core.themes()

        #expect(themes.contains { $0.id == "github-light" && $0.kind == .light })
        #expect(themes.first?.colors["issue-open"] != nil)
    }
}

@Suite struct GitHubAddresses {
    @Test func keepsAPlusInASearch() throws {
        let api = GitHubAPI(credentials: Credentials(keychain: Keychain(service: "test", account: "none"), environment: [:]))
        let url = api.url(
            for: GitHubRequest(method: "GET", path: "search/issues", query: [["q", "label:\"c++\" is:open"], ["page", "2"]]))

        #expect(url?.absoluteString == "https://api.github.com/search/issues?q=label%3A%22c%2B%2B%22%20is%3Aopen&page=2")
    }

    @Test func followsRedirectsOnlyWithinTheAPI() {
        #expect(RedirectsWithinAPI.allows(URL(string: "https://api.github.com/repositories/42")))
        #expect(!RedirectsWithinAPI.allows(URL(string: "https://example.com/repositories/42")))
        #expect(!RedirectsWithinAPI.allows(URL(string: "http://api.github.com/repositories/42")))
        #expect(!RedirectsWithinAPI.allows(URL(string: "https://api.github.com.evil.example/")))
    }

    @Test func readsRepositoryAddresses() {
        #expect(RepositoryAddress(parsing: "chris-metz/verdandi") == .init(owner: "chris-metz", name: "verdandi"))
        #expect(RepositoryAddress(parsing: "https://github.com/chris-metz/verdandi/issues") == .init(owner: "chris-metz", name: "verdandi"))
        #expect(RepositoryAddress(parsing: "chris-metz") == nil)
        #expect(RepositoryAddress(parsing: "a/b/c") == nil)
    }
}

@Suite struct StartingTheCore {
    @Test func failsWhenTheBundleThrows() {
        #expect(throws: CoreRuntime.Failure.self) {
            try Core(
                script: "throw new Error('broken bundle')",
                options: .init(home: "/tmp", interfaceFont: "SF Pro", codeFont: "SF Mono", installedFonts: []),
                github: FakeGitHub(answer: signedIn))
        }
    }

    @Test func failsWhenTheHostCannotStart() {
        let script = "globalThis.__host = { start() { throw new Error('no core') } };"
        #expect(throws: CoreRuntime.Failure.self) {
            try Core(
                script: script,
                options: .init(home: "/tmp", interfaceFont: "SF Pro", codeFont: "SF Mono", installedFonts: []),
                github: FakeGitHub(answer: signedIn))
        }
    }
}
