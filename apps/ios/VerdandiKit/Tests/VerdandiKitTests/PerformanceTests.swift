import Foundation
import Testing

@testable import VerdandiKit

/// How long a big list takes on JavaScriptCore, read from the real GitHub:
/// `VERDANDI_PERF=1 GH_TOKEN="$(gh auth token)" scripts/test-kit.sh --filter Performance`.
/// `JSC_useJIT=false` measures it as on an iPhone, where apps run
/// JavaScript without a JIT.
@Suite(.enabled(if: ProcessInfo.processInfo.environment["VERDANDI_PERF"] == "1"))
struct Performance {
    @Test func loadsABigList() async throws {
        let credentials = Credentials(keychain: Keychain(service: "verdandi-perf-tests", account: "none"))
        let core = try Core(
            script: try coreScript(),
            options: .init(home: try temporaryHome().path(), interfaceFont: "SF Pro", codeFont: "SF Mono", installedFonts: []),
            github: GitHubAPI(credentials: credentials))
        _ = try await core.checkSetupAgain()
        let repository = RepositoryAddress(owner: "cli", name: "cli")
        _ = try await core.addRepositories([repository])

        let start = ContinuousClock.now
        try await core.openList(.repository(repository))
        var pushes = 0
        var issues = 0
        for await event in core.events {
            guard case .listChanged(let list) = event else { continue }
            pushes += 1
            if case .current = list.loading.state {
                func count(_ nodes: [IssueNode]) -> Int { nodes.reduce(0) { $0 + 1 + count($1.subIssues) } }
                issues = count(list.trees)
                break
            }
        }
        let elapsed = ContinuousClock.now - start
        print("cli/cli: \(issues) issues in \(pushes) pushes, \(elapsed)")
        #expect(issues > 500)
    }
}
