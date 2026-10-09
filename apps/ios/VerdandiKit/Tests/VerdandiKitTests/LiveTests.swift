import Foundation
import Testing

@testable import VerdandiKit

/// Reads the real GitHub, with `GH_TOKEN`: `VERDANDI_LIVE=1
/// GH_TOKEN="$(gh auth token)" scripts/test-kit.sh --filter Live`.
@Suite(.enabled(if: ProcessInfo.processInfo.environment["VERDANDI_LIVE"] == "1"))
struct Live {
    let repository = RepositoryAddress(owner: "chris-metz", name: "verdandi")

    func start() throws -> Core {
        let credentials = Credentials(keychain: Keychain(service: "verdandi-live-tests", account: "none"))
        return try Core(
            script: try coreScript(),
            options: .init(home: try temporaryHome().path(), interfaceFont: "SF Pro", codeFont: "SF Mono", installedFonts: []),
            github: GitHubAPI(credentials: credentials))
    }

    /// Waits for the first event `match` takes, for at most 60 seconds.
    func first<T: Sendable>(_ core: Core, _ match: @escaping @Sendable (CoreEvent) -> T?) async throws -> T {
        try await withThrowingTaskGroup(of: T?.self) { group in
            group.addTask {
                for await event in core.events { if let value = match(event) { return value } }
                return nil
            }
            group.addTask {
                try await Task.sleep(for: .seconds(60))
                return nil
            }
            defer { group.cancelAll() }
            guard let value = try await group.next() ?? nil else { throw CoreRuntime.Failure(message: "No such event in time.") }
            return value
        }
    }

    @Test func readsARepositorysListAndAnIssuePage() async throws {
        let core = try start()
        let setup = try await core.checkSetupAgain()
        #expect(setup.account != nil)

        let added = try await core.addRepositories([repository])
        guard case .added = added.first?.outcome else {
            Issue.record("not added: \(added)")
            return
        }
        try await core.openList(.repository(repository))
        let list = try await first(core) { event -> IssueList? in
            if case .listChanged(let list) = event, case .current = list.loading.state { return list }
            return nil
        }
        #expect(!list.trees.isEmpty)
        #expect(list.loading.counts != nil)

        let issueId = try #require(list.trees.first?.issue.id)
        try await core.openIssuePage(issueId)
        let page = try await first(core) { event -> IssuePage? in
            if case .issuePageChanged(let page) = event, page.issueId == issueId, case .current = page.loading {
                return page
            }
            return nil
        }
        #expect(page.issue?.bodyHTML != nil)
        #expect(page.comments != nil)
        #expect(page.blockingMap != nil)
    }

    @Test func runsASearch() async throws {
        let core = try start()
        _ = try await core.checkSetupAgain()

        let saved = try await core.saveView(ViewDraft(name: "Open in Verdandi", query: "repo:chris-metz/verdandi is:issue is:open"))

        guard case .saved(let view) = saved else {
            Issue.record("not saved: \(saved)")
            return
        }
        try await core.openView(view.id)
        let list = try await first(core) { event -> ViewList? in
            if case .viewChanged(let list) = event, case .current = list.loading, !list.readingContext { return list }
            return nil
        }
        #expect(list.matchCount != nil)
    }
}
