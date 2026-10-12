import CryptoKit
import Foundation
import JavaScriptCore
import os

/// Runs the core's bundle (`core.js`, from `apps/ios/host`) on
/// JavaScriptCore. Everything that touches the JavaScript context happens on
/// one serial queue: the app's requests, the core's events, its timers, its
/// file operations and GitHub's answers. JavaScriptCore runs the promises a
/// call settles before the call returns to Swift.
public final class CoreRuntime: @unchecked Sendable {
    /// What the host is started with (`HostOptions` in `host.ts`).
    public struct Options: Encodable, Sendable {
        public var home: String
        public var fonts: Fonts

        public struct Fonts: Encodable, Sendable {
            public var interfaceFont: String
            public var codeFont: String
            public var installed: [String]
        }

        public init(home: String, interfaceFont: String, codeFont: String, installedFonts: [String]) {
            self.home = home
            fonts = Fonts(interfaceFont: interfaceFont, codeFont: codeFont, installed: installedFonts)
        }
    }

    /// A request the core failed, with its message.
    public struct Failure: Error, LocalizedError, Sendable {
        public var message: String
        public var errorDescription: String? { message }
    }

    public typealias EventHandler = @Sendable (_ name: String, _ payload: Data) -> Void

    /// The last exception nothing caught, until it is taken: only touched
    /// on the runtime's queue.
    private final class Uncaught: @unchecked Sendable {
        var last: String?
        func take() -> String? {
            defer { last = nil }
            return last
        }
    }

    static let log = Logger(subsystem: "io.github.chris-metz.verdandi", category: "core")

    private let queue = DispatchQueue(label: "io.github.chris-metz.verdandi.core", qos: .userInitiated)
    private let github: any GitHubTransport
    private let onEvent: EventHandler
    // Only on `queue`:
    private var context: JSContext?
    private var host: JSValue?
    private var nextRequest = 1
    private var pending: [Int: CheckedContinuation<Data, any Error>] = [:]
    private var timers: [Int: DispatchWorkItem] = [:]
    private var watches: [Int: any DispatchSourceFileSystemObject] = [:]

    /// Loads the bundle and starts the core in it.
    public init(script: String, options: Options, github: any GitHubTransport, onEvent: @escaping EventHandler) throws {
        self.github = github
        self.onEvent = onEvent
        let optionsJSON = String(decoding: try JSONEncoder().encode(options), as: UTF8.self)
        try queue.sync {
            guard let context = JSContext() else { throw Failure(message: "JavaScriptCore could not start.") }
            context.name = "Verdandi core"
            // A handler of its own keeps JavaScriptCore from setting
            // `context.exception`, so it keeps the last one itself, for
            // loading and starting to tell.
            let uncaught = Uncaught()
            context.exceptionHandler = { _, exception in
                let text = exception?.toString() ?? "?"
                uncaught.last = text
                Self.log.error("Uncaught: \(text, privacy: .public)")
            }
            context.setObject(self.natives(in: context), forKeyedSubscript: "__native" as NSString)
            context.evaluateScript(script, withSourceURL: URL(string: "verdandi://core.js"))
            if let exception = uncaught.take() {
                throw Failure(message: "The core could not load: \(exception)")
            }
            guard let host = context.objectForKeyedSubscript("__host"), host.isObject else {
                throw Failure(message: "The core's bundle has no host.")
            }
            self.context = context
            self.host = host
            host.invokeMethod("start", withArguments: [optionsJSON])
            if let exception = uncaught.take() {
                throw Failure(message: "The core could not start: \(exception)")
            }
        }
    }

    /// Makes a request of the contract, its arguments as JSON, and answers
    /// the core's JSON.
    public func request(_ name: String, argumentsJSON: String) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            queue.async { [self] in
                guard let host else {
                    continuation.resume(throwing: Failure(message: "The core has stopped."))
                    return
                }
                let id = nextRequest
                nextRequest += 1
                pending[id] = continuation
                host.invokeMethod("request", withArguments: [id, name, argumentsJSON])
            }
        }
    }

    /// Calls a function of the host that answers at once, such as `themes`,
    /// with its arguments as strings.
    public func call(_ function: String, _ arguments: [String] = []) async -> String? {
        await withCheckedContinuation { continuation in
            queue.async { [self] in
                continuation.resume(returning: host?.invokeMethod(function, withArguments: arguments)?.toString())
            }
        }
    }

    // MARK: - What the host calls

    private func natives(in context: JSContext) -> JSValue {
        let natives = JSValue(newObjectIn: context)!
        func set(_ name: String, _ block: Any) {
            natives.setObject(block, forKeyedSubscript: name as NSString)
        }
        let log: @convention(block) (String, String) -> Void = { level, message in
            switch level {
            case "error": Self.log.error("\(message, privacy: .public)")
            case "warn": Self.log.warning("\(message, privacy: .public)")
            case "debug": Self.log.debug("\(message, privacy: .public)")
            default: Self.log.info("\(message, privacy: .public)")
            }
        }
        set("log", log)
        let startTimer: @convention(block) (Int, Double) -> Void = { [weak self] id, milliseconds in
            self?.startTimer(id, after: milliseconds)
        }
        set("startTimer", startTimer)
        let cancelTimer: @convention(block) (Int) -> Void = { [weak self] id in
            self?.timers.removeValue(forKey: id)?.cancel()
        }
        set("cancelTimer", cancelTimer)
        let randomUUID: @convention(block) () -> String = { UUID().uuidString.lowercased() }
        set("randomUUID", randomUUID)
        let sha256: @convention(block) (String) -> String = { text in
            SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
        }
        set("sha256", sha256)
        let fileSystem: @convention(block) (String, String) -> String = { operation, argsJSON in
            NodeFileSystem.run(operation, argsJSON: argsJSON)
        }
        set("fs", fileSystem)
        let watchFolder: @convention(block) (Int, String) -> Bool = { [weak self] id, path in
            self?.watchFolder(id, path: path) ?? false
        }
        set("watchFolder", watchFolder)
        let unwatchFolder: @convention(block) (Int) -> Void = { [weak self] id in
            self?.watches.removeValue(forKey: id)?.cancel()
        }
        set("unwatchFolder", unwatchFolder)
        let github: @convention(block) (Int, String) -> Void = { [weak self] id, requestJSON in
            self?.sendToGitHub(id, requestJSON: requestJSON)
        }
        set("github", github)
        let tokenSource: @convention(block) () -> String = { [weak self] in
            self?.github.tokenSource()?.rawValue ?? ""
        }
        set("tokenSource", tokenSource)
        let emit: @convention(block) (String, String) -> Void = { [weak self] name, payloadJSON in
            self?.onEvent(name, Data(payloadJSON.utf8))
        }
        set("emit", emit)
        let respond: @convention(block) (Int, Bool, String) -> Void = { [weak self] id, ok, payloadJSON in
            self?.respond(id, ok: ok, payloadJSON: payloadJSON)
        }
        set("respond", respond)
        return natives
    }

    private func startTimer(_ id: Int, after milliseconds: Double) {
        let item = DispatchWorkItem { [weak self] in
            guard let self, self.timers.removeValue(forKey: id) != nil else { return }
            self.host?.invokeMethod("fireTimer", withArguments: [id])
        }
        timers[id] = item
        queue.asyncAfter(deadline: .now() + max(0, milliseconds) / 1000, execute: item)
    }

    private func watchFolder(_ id: Int, path: String) -> Bool {
        let descriptor = open(path, O_EVTONLY)
        guard descriptor >= 0 else { return false }
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: descriptor, eventMask: [.write, .rename, .delete, .extend, .attrib], queue: queue)
        source.setEventHandler { [weak self] in
            self?.host?.invokeMethod("folderChanged", withArguments: [id])
        }
        source.setCancelHandler { close(descriptor) }
        watches[id] = source
        source.resume()
        return true
    }

    private func sendToGitHub(_ id: Int, requestJSON: String) {
        let github = self.github
        Task.detached { [weak self] in
            let outcome: GitHubOutcome
            do {
                let request = try JSONDecoder().decode(GitHubRequest.self, from: Data(requestJSON.utf8))
                outcome = await github.send(request)
            } catch {
                outcome = .unreachable(message: "The request could not be read: \(error)")
            }
            let outcomeJSON = String(decoding: (try? JSONEncoder().encode(outcome)) ?? Data(), as: UTF8.self)
            self?.answer(id, outcomeJSON: outcomeJSON)
        }
    }

    private func answer(_ id: Int, outcomeJSON: String) {
        queue.async { [self] in
            host?.invokeMethod("githubAnswered", withArguments: [id, outcomeJSON])
        }
    }

    private func respond(_ id: Int, ok: Bool, payloadJSON: String) {
        guard let continuation = pending.removeValue(forKey: id) else { return }
        if ok {
            continuation.resume(returning: Data(payloadJSON.utf8))
        } else {
            struct Message: Decodable { var message: String }
            let message = (try? JSONDecoder().decode(Message.self, from: Data(payloadJSON.utf8)))?.message
            continuation.resume(throwing: Failure(message: message ?? "The core failed the request."))
        }
    }
}
