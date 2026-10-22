import Foundation
import os

/// An event the core pushes (`CoreEvents` in the contract).
public enum CoreEvent: Sendable {
    case setupChanged(Setup)
    case notice(Notice)
    case listChanged(IssueList)
    case issuePageChanged(IssuePage)
    case viewChanged(ViewList)
    case sidebarChanged(SidebarEntries)
    case rateLimitsChanged([RateLimitState])
    case rateLimitBudgetsChanged([RateLimitBudget])
    case repositorySuggestionsChanged(RepositorySuggestions)
    case configChanged(ConfigState)
    case checkoutsChanged(Checkouts)

    /// Reads an event as the core pushed it, by name, or none for one this
    /// app does not know.
    static func decode(name: String, payload: Data) throws -> CoreEvent? {
        let decoder = JSONDecoder()
        func read<T: Decodable>(_ type: T.Type) throws -> T { try decoder.decode(type, from: payload) }
        switch name {
        case "setupChanged": return .setupChanged(try read(Setup.self))
        case "notice": return .notice(try read(Notice.self))
        case "listChanged": return .listChanged(try read(IssueList.self))
        case "issuePageChanged": return .issuePageChanged(try read(IssuePage.self))
        case "viewChanged": return .viewChanged(try read(ViewList.self))
        case "sidebarChanged": return .sidebarChanged(try read(SidebarEntries.self))
        case "rateLimitsChanged": return .rateLimitsChanged(try read([RateLimitState].self))
        case "rateLimitBudgetsChanged": return .rateLimitBudgetsChanged(try read([RateLimitBudget].self))
        case "repositorySuggestionsChanged": return .repositorySuggestionsChanged(try read(RepositorySuggestions.self))
        case "configChanged": return .configChanged(try read(ConfigState.self))
        case "checkoutsChanged": return .checkoutsChanged(try read(Checkouts.self))
        default: return nil
        }
    }
}

/// A theme Verdandi ships, with its colours by token, as the desktop app's
/// `Theme`: `#rrggbb` or `#rrggbbaa`.
public struct Theme: Decodable, Hashable, Sendable, Identifiable {
    public enum Kind: String, Decodable, Sendable { case light, dark }
    public var id: String
    public var name: String
    public var kind: Kind
    public var colors: [String: String]
}

/// The core, as the app uses it: the contract's requests as typed async
/// functions, and its events as one stream, in the order pushed.
public final class Core: Sendable {
    let runtime: CoreRuntime
    /// The core's events. Read it from one place only.
    public let events: AsyncStream<CoreEvent>

    static let log = Logger(subsystem: "io.github.chris-metz.verdandi", category: "events")

    /// Starts the core from its bundle.
    public convenience init(script: String, options: CoreRuntime.Options, github: any GitHubTransport) throws {
        try self.init(script: script, options: options, github: github) { _, _ in }
    }

    /// Starts the core, telling `read` of each event as it is read, or why
    /// it could not be: `ContractTests` fails on that.
    init(
        script: String, options: CoreRuntime.Options, github: any GitHubTransport,
        read: @escaping @Sendable (_ name: String, _ event: Result<CoreEvent?, any Error>) -> Void
    ) throws {
        let (events, continuation) = AsyncStream.makeStream(of: CoreEvent.self, bufferingPolicy: .unbounded)
        self.events = events
        runtime = try CoreRuntime(script: script, options: options, github: github) { name, payload in
            // Read on the core's queue, so the main actor only takes it.
            let event = Result { try CoreEvent.decode(name: name, payload: payload) }
            read(name, event)
            switch event {
            case .success(let event?): continuation.yield(event)
            case .success(nil): break
            case .failure(let error):
                Self.log.error("Cannot read \(name, privacy: .public): \(String(describing: error), privacy: .public)")
            }
        }
    }

    // MARK: - Calling the contract

    private func send(_ name: String, _ arguments: [any Encodable & Sendable]) async throws -> Data {
        let json = try JSONEncoder().encode(arguments.map(AnyEncodable.init))
        return try await runtime.request(name, argumentsJSON: String(decoding: json, as: UTF8.self))
    }

    private func call<T: Decodable>(_ name: String, _ arguments: any Encodable & Sendable...) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await send(name, arguments))
    }

    private func perform(_ name: String, _ arguments: any Encodable & Sendable...) async throws {
        _ = try await send(name, arguments)
    }

    /// Every theme Verdandi ships.
    public func themes() async -> [Theme] {
        guard let json = await runtime.call("themes") else { return [] }
        return (try? JSONDecoder().decode([Theme].self, from: Data(json.utf8))) ?? []
    }

    // MARK: Setup

    public func getSetup() async throws -> Setup { try await call("getSetup") }
    public func checkSetupAgain() async throws -> Setup { try await call("checkSetupAgain") }

    // MARK: Sidebar and settings

    public func getSidebar() async throws -> SidebarEntries { try await call("getSidebar") }
    public func reloadSettings() async throws { try await perform("reloadSettings") }
    public func resetSettings() async throws -> ChangeResult { try await call("resetSettings") }
    public func reorderSidebar(_ entry: SidebarEntryKey, _ destination: SidebarDestination) async throws -> ChangeResult {
        try await call("reorderSidebar", entry, destination)
    }
    public func removeRepository(_ repository: TrackedRepository) async throws -> ChangeResult {
        try await call("removeRepository", repository)
    }
    public func replaceRepository(_ repository: TrackedRepository) async throws -> RepositoryAddition {
        try await call("replaceRepository", repository)
    }

    // MARK: Repository picker

    public func openRepositoryPicker() async throws { try await perform("openRepositoryPicker") }
    public func closeRepositoryPicker() async throws { try await perform("closeRepositoryPicker") }
    public func checkRepository(_ repository: RepositoryAddress) async throws -> RepositoryCheck {
        try await call("checkRepository", repository)
    }
    public func addRepositories(_ repositories: [RepositoryAddress]) async throws -> [RepositoryAddition] {
        try await call("addRepositories", repositories)
    }
    public func skipRepositoryPicker() async throws -> ChangeResult { try await call("skipRepositoryPicker") }

    // MARK: Views

    public func saveView(_ draft: ViewDraft, force: Bool = false) async throws -> ViewSave {
        struct Options: Encodable, Sendable { var force: Bool }
        return try await call("saveView", draft, Options(force: force))
    }
    public func removeView(_ id: String) async throws -> ChangeResult { try await call("removeView", id) }
    public func openView(_ id: String) async throws { try await perform("openView", id) }

    // MARK: Lists

    public func openList(_ scope: Scope) async throws { try await perform("openList", scope) }
    public func switchState(_ scope: Scope, to state: IssueState) async throws {
        try await perform("switchState", scope, state)
    }
    public func setSortOrder(_ scope: Scope, to sortOrder: ListSortOrder) async throws {
        try await perform("setSortOrder", scope, sortOrder)
    }
    public func setExpanded(_ list: ExpandableList, issueId: String, expanded: Bool) async throws {
        try await perform("setExpanded", list, issueId, expanded)
    }
    public func setAllExpanded(_ list: ExpandableList, expanded: Bool) async throws {
        try await perform("setAllExpanded", list, expanded)
    }
    public func addLabelToFilter(_ list: ExpandableList, _ label: IssueLabel) async throws {
        try await perform("addLabelToFilter", list, label)
    }
    public func removeLabelFromFilter(_ list: ExpandableList, name: String) async throws {
        try await perform("removeLabelFromFilter", list, name)
    }
    public func clearLabelFilter(_ list: ExpandableList) async throws { try await perform("clearLabelFilter", list) }

    // MARK: What is on screen

    public func refresh(_ screen: Screen?) async throws { try await perform("refresh", OptionalArgument(screen)) }
    public func revalidate(_ screen: Screen?) async throws { try await perform("revalidate", OptionalArgument(screen)) }
    public func retry(_ screen: Screen?) async throws { try await perform("retry", OptionalArgument(screen)) }

    // MARK: Issue pages

    public func openIssuePage(_ issueId: String) async throws { try await perform("openIssuePage", issueId) }
    public func activateBlockingEnd(_ issueId: String, side: BlockingSide) async throws {
        try await perform("activateBlockingEnd", issueId, side)
    }
    public func retryBlockingBranch(_ issueId: String, cardId: String, side: BlockingSide) async throws {
        try await perform("retryBlockingBranch", issueId, cardId, side)
    }
    public func renewMediaLinks(_ issueId: String, bodyId: String) async throws -> RenewedMediaLinks {
        try await call("renewMediaLinks", issueId, bodyId)
    }
    public func lookUpIssue(_ repository: RepositoryAddress, number: Int) async throws -> IssueLookup {
        try await call("lookUpIssue", repository, number)
    }

    // MARK: Recent issues and tabs

    public func getRecentIssues() async throws -> [RecentIssue] { try await call("getRecentIssues") }
    public func recordRecentIssue(_ issue: RecentIssue) async throws { try await perform("recordRecentIssue", issue) }
    public func getTabs() async throws -> RestoredTabs { try await call("getTabs") }
    public func saveTabs(_ tabs: SavedTabs) async throws { try await perform("saveTabs", tabs) }

    // MARK: Rate limits

    public func getRateLimits() async throws -> [RateLimitState] { try await call("getRateLimits") }
    public func getRateLimitBudgets() async throws -> [RateLimitBudget] { try await call("getRateLimitBudgets") }

    // MARK: Look

    public func getConfig() async throws -> ConfigState { try await call("getConfig") }
    public func changeConfig(_ change: ConfigChange) async throws -> ChangeResult { try await call("changeConfig", change) }
}

/// Any encodable value, so that requests take arguments of several types.
private struct AnyEncodable: Encodable, Sendable {
    let value: any Encodable & Sendable
    func encode(to encoder: any Encoder) throws { try value.encode(to: encoder) }
}

/// An optional argument: `null` in JSON for none, which the core reads as
/// `undefined` would be.
private struct OptionalArgument<Wrapped: Encodable & Sendable>: Encodable, Sendable {
    let wrapped: Wrapped?
    init(_ wrapped: Wrapped?) { self.wrapped = wrapped }
    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        if let wrapped { try container.encode(wrapped) } else { try container.encodeNil() }
    }
}
