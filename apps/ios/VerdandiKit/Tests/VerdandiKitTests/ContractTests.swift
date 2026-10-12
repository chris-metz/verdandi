import Foundation
import Synchronization
import Testing

@testable import VerdandiKit

// The Swift types mirror `packages/core/src/contract.ts` by hand. These tests
// run the core on JavaScriptCore with its own GitHub in memory, the world
// `host/testing/contract-entry.ts` declares, make every request the app
// makes through `Core`, and read every answer and event on the Swift types:
// a change to the contract they do not follow fails here, rather than leave
// a screen empty.

/// The core on its GitHub in memory, as `scripts/test-kit.sh` bundles it.
private func contractScript() throws -> String {
    try bundledScript("build/contract-core.js", unless: "VERDANDI_CONTRACT_JS")
}

/// A step of the tests that did not come about, so the ones after it
/// cannot run.
private struct StepFailed: Error, CustomStringConvertible {
    var description: String
}

/// The requests the app does not make through `Core`: the desktop's window
/// and sidebar, and choosing gh, which iOS has none of; and the installed
/// fonts, which the host gives the core as it starts it.
private let requestsNotOnIOS: Set<String> = [
    "getWindowState", "saveWindowState", "getSidebarHidden", "saveSidebarHidden",
    "getSidebarWidth", "saveSidebarWidth", "chooseGhExecutable", "setInstalledFonts",
]

/// The events the core pushed, as the Swift types read them, and those they
/// could not read.
private final class PushedEvents: Sendable {
    private struct State {
        var events: [CoreEvent] = []
        var names: Set<String> = []
        var unreadable: [String] = []
    }

    private let state = Mutex(State())

    func record(_ name: String, _ event: Result<CoreEvent?, any Error>) {
        state.withLock { state in
            switch event {
            case .success(let event?):
                state.events.append(event)
                state.names.insert(name)
            case .success(nil): state.unreadable.append("\(name): no case of CoreEvent")
            case .failure(let error): state.unreadable.append("\(name): \(error)")
            }
        }
    }

    var names: Set<String> { state.withLock { $0.names } }
    var unreadable: [String] { state.withLock { $0.unreadable } }
    /// Where the events pushed from now on start.
    var mark: Int { state.withLock { $0.events.count } }

    /// The first event since `mark` that `match` takes, as it takes it. It
    /// stops at once when an event cannot be read, which it may be waiting
    /// for.
    func first<T>(
        since mark: Int = 0, _ what: String, sourceLocation: SourceLocation = #_sourceLocation,
        _ match: @escaping (CoreEvent) -> T?
    ) async throws -> T {
        for _ in 0..<1000 {
            let (events, unreadable) = state.withLock { (Array($0.events.dropFirst(mark)), $0.unreadable) }
            if let found = events.lazy.compactMap(match).first { return found }
            if !unreadable.isEmpty {
                throw StepFailed(description: "Waiting for \(what), could not read \(unreadable.joined(separator: "; "))")
            }
            try await Task.sleep(for: .milliseconds(10))
        }
        Issue.record("No event: \(what)", sourceLocation: sourceLocation)
        throw StepFailed(description: "No event: \(what)")
    }
}

private struct ContractNames: Decodable {
    var requests: Set<String>
    var events: Set<String>
}

/// The core on its GitHub in memory, and what it pushes.
private struct ContractCore {
    let core: Core
    let reads: PushedEvents
    let home: URL

    init() throws {
        let reads = PushedEvents()
        home = try temporaryHome()
        core = try Core(
            script: try contractScript(), options: testOptions(home: home),
            github: FakeGitHub { _ in .unreachable(message: "The contract tests reach no GitHub but their own.") },
            read: reads.record)
        self.reads = reads
    }

    /// Calls a method of the core's `FakeGitHub`, e.g. `failWith`.
    func gitHub(_ method: String, _ arguments: Any...) async {
        _ = await core.runtime.call("fakeGitHub", [method, json(arguments)])
    }

    func hostJSON<T: Decodable>(_ function: String, as type: T.Type) async throws -> T {
        let text = try #require(await core.runtime.call(function))
        return try JSONDecoder().decode(type, from: Data(text.utf8))
    }

    /// A scope's list in a state once nothing it shows is being read.
    func settledList(since mark: Int, _ scope: Scope, _ state: IssueState = .open) async throws -> IssueList {
        try await reads.first(since: mark, "the list of \(scope), \(state)") { event in
            guard case .listChanged(let list) = event, list.scope == scope, list.state == state,
                !list.loading.state.isBusy
            else { return nil }
            return list
        }
    }

    func settledView(since mark: Int, _ id: String) async throws -> ViewList {
        try await reads.first(since: mark, "the view \(id)") { event in
            guard case .viewChanged(let view) = event, view.view.id == id, !view.loading.isBusy,
                view.searching == nil, !view.readingContext
            else { return nil }
            return view
        }
    }

    func settledPage(since mark: Int, _ id: String) async throws -> IssuePage {
        try await reads.first(since: mark, "the page of \(id)") { event in
            guard case .issuePageChanged(let page) = event, page.issueId == id, !page.loading.isBusy,
                let comments = page.comments, !comments.loading.isBusy
            else { return nil }
            return page
        }
    }

    func sidebar(since mark: Int, _ what: String, _ match: @escaping (SidebarEntries.Read) -> Bool) async throws
        -> SidebarEntries.Read
    {
        try await reads.first(since: mark, what) { event in
            guard case .sidebarChanged(.read(let read)) = event, match(read) else { return nil }
            return read
        }
    }
}

private let api = RepositoryAddress(owner: "acme", name: "api")
private let web = RepositoryAddress(owner: "acme", name: "web")
private let bug = IssueLabel(name: "bug", color: "d73a4a")
private let mapIssue = "I_acme/api#1"
private let ghFailed = ["kind": "gh-failed", "message": "Could not connect to api.github.com."]

@Suite struct ContractOnSwift {
    @Test func readsEveryAnswerAndEventOfTheCore() async throws {
        let contract = try ContractCore()

        try await setUp(contract)
        try await pickRepositories(contract)
        let views = try await saveViews(contract)
        try await browseLists(contract)
        try await browseViews(contract, views)
        try await browseIssuePage(contract)
        try await keepTabsAndRecentIssues(contract, views)
        try await rearrangeTheSidebar(contract, views)
        try await refreshAndFail(contract, views)
        try await followGitHub(contract)
        try await changeTheLook(contract)
        try await recoverTheSettings(contract)

        let names = try await contract.hostJSON("contract", as: ContractNames.self)
        let requested = Set(try await contract.hostJSON("requested", as: [String].self))
        #expect(requestsNotOnIOS.isSubset(of: names.requests))
        #expect(names.requests.subtracting(requestsNotOnIOS).subtracting(requested).sorted() == [])
        #expect(names.events.subtracting(contract.reads.names).sorted() == [])
        #expect(contract.reads.unreadable == [])
    }

    private func setUp(_ contract: ContractCore) async throws {
        let core = contract.core
        _ = try await core.getSetup()
        let setup = try await core.checkSetupAgain()
        #expect(setup.account?.login == "octo-reader")
        _ = try await contract.reads.first("the setup, ready") { (event) -> Bool? in
            guard case .setupChanged(.ready) = event else { return nil }
            return true
        }
    }

    private func pickRepositories(_ contract: ContractCore) async throws {
        let core = contract.core
        guard case .read(let first) = try await core.getSidebar() else {
            Issue.record("The sidebar could not be read")
            return
        }
        #expect(first.firstLaunch)

        var mark = contract.reads.mark
        try await core.openRepositoryPicker()
        let suggestions = try await contract.reads.first(since: mark, "the picker's suggestions") { (event) -> RepositorySuggestions? in
            guard case .repositorySuggestionsChanged(let suggestions) = event, suggestions.loading != .loading
            else { return nil }
            return suggestions
        }
        #expect(suggestions.repositories.map(\.repository.nameWithOwner).sorted() == [
            "acme/api", "acme/docs", "acme/secret", "acme/web",
        ])
        #expect(suggestions.owners.map(\.login) == ["octo-reader", "acme"])

        guard case .found(let docs) = try await core.checkRepository(.init(owner: "acme", name: "docs")) else {
            Issue.record("acme/docs was not found")
            return
        }
        #expect(docs.unavailable == .issuesDisabled)
        let missing = try await core.checkRepository(.init(owner: "nobody", name: "none"))
        #expect(missing == .failed(.unavailable(access: nil, issuesDisabled: false, nameTakenOver: false)))

        mark = contract.reads.mark
        let added = try await core.addRepositories([api, web, .init(owner: "acme", name: "secret")])
        let outcomes = added.map { addition in
            if case .added = addition.outcome { return "added" }
            return "not added"
        }
        #expect(outcomes == ["added", "added", "not added"])
        if case .unavailable(let secret) = added.last?.outcome {
            #expect(secret.unavailable == .noIssueAccess(access: nil))
        } else {
            Issue.record("acme/secret was added: \(String(describing: added.last))")
        }
        try await core.closeRepositoryPicker()
        _ = try await contract.sidebar(since: mark, "the sidebar's counts") { sidebar in
            sidebar.repositories.count == 2 && sidebar.repositories.allSatisfy { $0.openIssues.count != nil }
        }
    }

    private struct Views {
        var bugs: SavedView
        var invalid: SavedView
        var unsearchable: SavedView
    }

    private func saveViews(_ contract: ContractCore) async throws -> Views {
        let core = contract.core
        guard case .saved(let bugs) = try await core.saveView(ViewDraft(name: "Bugs", query: "is:open label:bug"))
        else { throw StepFailed(description: "The view Bugs was not saved") }
        #expect(
            try await core.saveView(ViewDraft(name: "Sorted", query: "is:open sort:"))
                == .rejected(message: "The search is invalid."))
        #expect(
            try await core.saveView(ViewDraft(name: "Elsewhere", query: "repo:nobody/none"))
                == .rejected(message: "The listed repositories cannot be searched."))
        if case .failed = try await core.saveView(ViewDraft(name: "", query: "")) {} else {
            Issue.record("A view without a name was saved")
        }
        await contract.gitHub("failWith", ghFailed)
        if case .unchecked = try await core.saveView(ViewDraft(name: "Later", query: "is:closed")) {} else {
            Issue.record("A view was saved without its search")
        }
        await contract.gitHub("failWith")
        guard
            case .saved(let invalid) = try await core.saveView(
                ViewDraft(name: "Sorted", query: "is:open sort:", after: bugs.id), force: true)
        else { throw StepFailed(description: "The view Sorted was not saved") }
        guard
            case .saved(let unsearchable) = try await core.saveView(
                ViewDraft(name: "Elsewhere", query: "repo:nobody/none"), force: true)
        else { throw StepFailed(description: "The view Elsewhere was not saved") }
        return Views(bugs: bugs, invalid: invalid, unsearchable: unsearchable)
    }

    private func browseLists(_ contract: ContractCore) async throws {
        let core = contract.core
        var mark = contract.reads.mark
        try await core.openList(.all)
        let all = try await contract.settledList(since: mark, .all)
        #expect(all.repositories.map(\.repository) == [api, web])

        mark = contract.reads.mark
        try await core.openList(.repository(api))
        let open = try await contract.settledList(since: mark, .repository(api))
        let map = try #require(open.trees.first { $0.id == mapIssue })
        #expect(map.issue.labels == [bug])
        #expect(map.subIssues.map(\.id) == ["I_acme/api#2", "I_other/lib#5"])
        #expect(map.subIssues.last?.issue.external == true)
        if case .unavailable = map.issue.incomplete {} else { Issue.record("#1 is not incomplete: \(map.issue)") }
        #expect(open.loading.counts != nil)

        mark = contract.reads.mark
        try await core.switchState(.repository(api), to: .closed)
        let closed = try await contract.settledList(since: mark, .repository(api), .closed)
        #expect(closed.trees.contains { $0.id == "I_acme/api#8" })
        mark = contract.reads.mark
        try await core.switchState(.repository(api), to: .open)
        _ = try await contract.settledList(since: mark, .repository(api))

        let list = ExpandableList.scope(.repository(api))
        mark = contract.reads.mark
        try await core.setExpanded(list, issueId: mapIssue, expanded: false)
        try await core.setAllExpanded(.scope(.all), expanded: true)
        try await core.addLabelToFilter(list, bug)
        let filtered = try await contract.reads.first(since: mark, "the list with a label filter") { (event) -> IssueList? in
            guard case .listChanged(let list) = event, list.scope == .repository(api), list.labelFilter == [bug]
            else { return nil }
            return list
        }
        #expect(filtered.trees.first?.mark?.match == true)
        try await core.removeLabelFromFilter(list, name: "bug")
        try await core.addLabelToFilter(.scope(.all), bug)
        try await core.clearLabelFilter(.scope(.all))
    }

    private func browseViews(_ contract: ContractCore, _ views: Views) async throws {
        let core = contract.core
        var mark = contract.reads.mark
        try await core.openView(views.bugs.id)
        let bugs = try await contract.settledView(since: mark, views.bugs.id)
        #expect(bugs.trees.first?.id == mapIssue)
        #expect(bugs.pullRequests == 1)

        let list = ExpandableList.view(id: views.bugs.id)
        try await core.setExpanded(list, issueId: mapIssue, expanded: true)
        try await core.setAllExpanded(list, expanded: false)
        try await core.addLabelToFilter(list, bug)
        try await core.clearLabelFilter(list)

        mark = contract.reads.mark
        try await core.openView(views.invalid.id)
        let invalid = try await contract.settledView(since: mark, views.invalid.id)
        #expect(invalid.searchProblem == .invalid(message: "The search is invalid."))

        mark = contract.reads.mark
        try await core.openView(views.unsearchable.id)
        let unsearchable = try await contract.settledView(since: mark, views.unsearchable.id)
        #expect(unsearchable.searchProblem == .unsearchable(message: "The listed repositories cannot be searched."))
    }

    private func browseIssuePage(_ contract: ContractCore) async throws {
        let core = contract.core
        var mark = contract.reads.mark
        try await core.openIssuePage(mapIssue)
        let page = try await contract.settledPage(since: mark, mapIssue)
        #expect(page.issue?.milestone == "Autumn")
        #expect(page.issue?.assignees?.map(\.login) == ["octo-reader"])
        #expect(page.comments?.comments.map(\.author?.login) == ["octo-reader", nil])
        let blockingMap = try #require(page.blockingMap)
        #expect(Set(blockingMap.cards.map(\.id)) == ["I_acme/api#1", "I_acme/api#3", "I_acme/api#4"])
        #expect(blockingMap.edges.count == 3)

        mark = contract.reads.mark
        try await core.activateBlockingEnd(mapIssue, side: .blockedBy)
        try await core.retryBlockingBranch(mapIssue, cardId: "I_acme/api#3", side: .blockedBy)
        _ = try await contract.settledPage(since: mark, mapIssue)
        if case .renewed(let html) = try await core.renewMediaLinks(mapIssue, bodyId: mapIssue) {
            #expect(html.contains("private-user-images.githubusercontent.com"))
        } else {
            Issue.record("The body's media links were not renewed")
        }

        mark = contract.reads.mark
        try await core.openIssuePage("I_acme/api#6")
        _ = try await contract.reads.first(since: mark, "the page of a hidden issue") { (event) -> IssuePage? in
            guard case .issuePageChanged(let page) = event, page.issueId == "I_acme/api#6",
                case .failed(.unavailable) = page.loading
            else { return nil }
            return page
        }

        if case .found(let issue) = try await core.lookUpIssue(api, number: 3) {
            #expect(issue.id == "I_acme/api#3")
        } else {
            Issue.record("acme/api#3 was not found")
        }
        if case .pullRequest = try await core.lookUpIssue(api, number: 7) {} else {
            Issue.record("acme/api#7 is no pull request")
        }
        if case .failed = try await core.lookUpIssue(api, number: 99) {} else { Issue.record("acme/api#99 was found") }
    }

    private func keepTabsAndRecentIssues(_ contract: ContractCore, _ views: Views) async throws {
        let core = contract.core
        let recent = RecentIssue(id: mapIssue, repository: api, number: 1, title: "Draw the blocking map")
        try await core.recordRecentIssue(recent)
        #expect(try await core.getRecentIssues() == [recent])

        _ = try await core.getTabs()
        let issue = TabIssue(id: mapIssue, reference: "#1", title: "Draw the blocking map", url: nil)
        try await core.saveTabs(
            SavedTabs(
                tabs: [
                    SavedTab(entry: .all, issues: [issue]),
                    SavedTab(entry: .repository(api), issues: []),
                    SavedTab(entry: .view(id: views.bugs.id), issues: []),
                ], shown: 1))
        let restored = try await core.getTabs()
        #expect(restored.shown == 1)
        #expect(
            restored.tabs == [
                .entry(.all, issues: [issue]), .entry(.repository(api), issues: []),
                .entry(.view(views.bugs), issues: []),
            ])
    }

    private func rearrangeTheSidebar(_ contract: ContractCore, _ views: Views) async throws {
        let core = contract.core
        #expect(try await core.reorderSidebar(.repository(web), .up).ok)
        #expect(
            try await core.reorderSidebar(.view(id: views.bugs.id), .relative(to: .view(id: views.invalid.id), before: false))
                .ok)
        guard case .read(let sidebar) = try await core.getSidebar() else {
            Issue.record("The sidebar could not be read")
            return
        }
        #expect(sidebar.repositories.map(\.repository.address) == [web, api])
        #expect(sidebar.views.map(\.view.name) == ["Sorted", "Bugs", "Elsewhere"])
    }

    private func refreshAndFail(_ contract: ContractCore, _ views: Views) async throws {
        let core = contract.core
        try await core.refresh(.list(.all))
        try await core.revalidate(.view(id: views.bugs.id))
        try await core.retry(.issue(id: mapIssue))
        try await core.refresh(nil)

        var mark = contract.reads.mark
        await contract.gitHub("failWith", ghFailed)
        try await core.refresh(.list(.repository(api)))
        let stale = try await contract.reads.first(since: mark, "a stale list") { (event) -> IssueList? in
            guard case .listChanged(let list) = event, case .stale = list.loading.state else { return nil }
            return list
        }
        if case .unreachable = stale.loading.state.problem {} else { Issue.record("Not unreachable: \(stale.loading)") }
        await contract.gitHub("failWith")

        mark = contract.reads.mark
        let sso = "Resource protected by organization SAML enforcement."
        await contract.gitHub("hide", "acme/web", ["kind": "sso", "message": sso, "url": "https://github.com/orgs/acme/sso"])
        try await core.refresh(nil)
        let hidden = try await contract.sidebar(since: mark, "acme/web, unavailable") { sidebar in
            sidebar.repositories.contains { $0.repository.address == web && $0.unavailable != nil }
        }
        let unavailable = hidden.repositories.first { $0.repository.address == web }?.unavailable
        #expect(
            unavailable
                == .unavailable(
                    access: .sso(message: sso, url: "https://github.com/orgs/acme/sso"), issuesDisabled: false,
                    nameTakenOver: false))
        await contract.gitHub("reveal", "acme/web")

        mark = contract.reads.mark
        let reset = Date.now.timeIntervalSince1970 * 1000 + 3_600_000
        await contract.gitHub("setBudget", "graphql", ["remaining": 10, "limit": 5000, "resetAt": reset])
        try await core.refresh(.list(.repository(api)))
        let low = try await contract.reads.first(since: mark, "a low rate limit") { (event) -> [RateLimitState]? in
            guard case .rateLimitsChanged(let limits) = event, limits.contains(where: { $0.status == .low })
            else { return nil }
            return limits
        }
        #expect(low.first?.pool == .graphql)
        #expect(try await core.getRateLimits().map(\.status) == [.low])
        #expect(try await core.getRateLimitBudgets().contains { $0.pool == .graphql && $0.limit == 5000 })
        _ = try await contract.reads.first(since: mark, "the rate-limit budgets") { (event) -> [RateLimitBudget]? in
            guard case .rateLimitBudgetsChanged(let budgets) = event, !budgets.isEmpty else { return nil }
            return budgets
        }
        await contract.gitHub("setBudget", "graphql", ["remaining": 5000, "limit": 5000, "resetAt": reset])
    }

    private func followGitHub(_ contract: ContractCore) async throws {
        let core = contract.core
        var mark = contract.reads.mark
        await contract.gitHub("renameRepository", "acme/web", "acme/site")
        try await core.refresh(nil)
        let renamed = try await contract.reads.first(since: mark, "a notice of the rename") { (event) -> [RepositoryRename]? in
            guard case .notice(.repositoriesRenamed(let renamed)) = event else { return nil }
            return renamed
        }
        #expect(renamed.map(\.to) == [.init(owner: "acme", name: "site")])

        mark = contract.reads.mark
        await contract.gitHub("signInAs", "octo-writer")
        _ = try await core.checkSetupAgain()
        try await core.refresh(.list(.repository(api)))
        let changed = try await contract.reads.first(since: mark, "a notice of another account") { (event) -> String? in
            guard case .notice(.accountChanged(let previous, let account)) = event else { return nil }
            return "\(previous.login) to \(account.login)"
        }
        #expect(changed == "octo-reader to octo-writer")

        await contract.gitHub("failAuthStatusWith", ghFailed)
        if case .ready(.unconfirmed) = try await core.checkSetupAgain() {} else {
            Issue.record("The account is not unconfirmed")
        }
        await contract.gitHub("failAuthStatusWith")

        await contract.gitHub("signOut")
        #expect(try await core.checkSetupAgain() == .blocked(.signedOut))
        await contract.gitHub("signInAs", "octo-writer", "GH_TOKEN")
        await contract.gitHub("rejectCredentials")
        let rejected = try await core.checkSetupAgain()
        if case .blocked(.credentialsRejected(_, .ghToken)) = rejected {} else {
            Issue.record("The credentials are not rejected: \(rejected)")
        }
        await contract.gitHub("signInAs", "octo-writer")
        #expect(try await core.checkSetupAgain().account?.login == "octo-writer")
    }

    private func changeTheLook(_ contract: ContractCore) async throws {
        let core = contract.core
        let config = try await core.getConfig()
        #expect(config.status == .missing)
        let mark = contract.reads.mark
        #expect(try await core.changeConfig(ConfigChange(appearance: .dark, interfaceFont: .some(nil))).ok)
        _ = try await contract.reads.first(since: mark, "the config, dark") { (event) -> ConfigState? in
            guard case .configChanged(let state) = event, state.config.appearance == .dark else { return nil }
            return state
        }
    }

    private func recoverTheSettings(_ contract: ContractCore) async throws {
        let core = contract.core
        let file = contract.home.appending(path: "settings.json")

        // The same repository twice under one ID, as after a hand edit.
        var mark = contract.reads.mark
        var settings = try #require(
            try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        var repositories = try #require(settings["repositories"] as? [[String: Any]])
        repositories.append(["name": "acme/api-old", "id": try #require(repositories.last?["id"])])
        settings["repositories"] = repositories
        try JSONSerialization.data(withJSONObject: settings).write(to: file)
        try await core.reloadSettings()
        _ = try await contract.reads.first(since: mark, "a notice of the duplicate") { (event) -> Bool? in
            guard case .notice(.duplicateRepositoriesRemoved) = event else { return nil }
            return true
        }

        mark = contract.reads.mark
        try Data("{ not json".utf8).write(to: file)
        try await core.reloadSettings()
        _ = try await contract.sidebar(since: mark, "the settings, invalid") { sidebar in
            if case .invalid = sidebar.settings { return true }
            return false
        }
        #expect(try await core.resetSettings().ok)

        mark = contract.reads.mark
        try Data(#"{ "version": 2, "repositories": [], "views": [] }"#.utf8).write(to: file)
        try await core.reloadSettings()
        _ = try await contract.sidebar(since: mark, "the settings, of a newer version") { sidebar in
            if case .newerVersion = sidebar.settings { return true }
            return false
        }
        try Data(#"{ "version": 1, "repositories": [], "views": [] }"#.utf8).write(to: file)
        try await core.reloadSettings()

        guard case .saved(let view) = try await core.saveView(ViewDraft(name: "Bugs", query: "is:open label:bug"))
        else { throw StepFailed(description: "The view Bugs was not saved again") }
        #expect(try await core.removeView(view.id).ok)
        let added = try await core.addRepositories([api])
        guard case .added(let repository) = added.first?.outcome else {
            Issue.record("acme/api was not added again")
            return
        }
        let tracked = TrackedRepository(owner: api.owner, name: api.name, id: repository.id)
        if case .added = try await core.replaceRepository(tracked).outcome {} else {
            Issue.record("acme/api was not tracked anew")
        }
        #expect(try await core.removeRepository(tracked).ok)
        #expect(try await core.skipRepositoryPicker().ok)
    }
}
