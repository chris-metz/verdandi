import Foundation
import Security
import Synchronization

/// A GitHub token and where it comes from.
public struct Token: Sendable, Equatable {
    public var value: String
    public var source: TokenSource

    public init(value: String, source: TokenSource) {
        self.value = value
        self.source = source
    }
}

/// The token GitHub is read with: `GH_TOKEN` or `GITHUB_TOKEN` when the app
/// was launched with one, as gh honours them (a development script passes
/// it into the Simulator), and otherwise the one the user signed in with,
/// kept in the Keychain on this device only.
public final class Credentials: Sendable {
    private let keychain: Keychain
    private let environment: Token?
    private let stored: Mutex<Token?>

    public init(
        keychain: Keychain = Keychain(service: "io.github.chris-metz.verdandi", account: "github.com"),
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) {
        self.keychain = keychain
        if let value = environment["GH_TOKEN"], !value.isEmpty {
            self.environment = Token(value: value, source: .ghToken)
        } else if let value = environment["GITHUB_TOKEN"], !value.isEmpty {
            self.environment = Token(value: value, source: .githubToken)
        } else {
            self.environment = nil
        }
        stored = Mutex(keychain.read().map { Token(value: $0, source: .stored) })
    }

    /// The token in use, if any.
    public var current: Token? {
        environment ?? stored.withLock { $0 }
    }

    /// Whether the token comes from the environment, which signing out
    /// cannot remove.
    public var fromEnvironment: Bool { environment != nil }

    /// Keeps a token the user signed in with.
    public func store(_ value: String) throws {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        try keychain.write(trimmed)
        stored.withLock { $0 = Token(value: trimmed, source: .stored) }
    }

    /// Forgets the token the user signed in with.
    public func remove() throws {
        try keychain.delete()
        stored.withLock { $0 = nil }
    }
}

/// One generic password in the Keychain, on this device only.
public struct Keychain: Sendable {
    public var service: String
    public var account: String

    public init(service: String, account: String) {
        self.service = service
        self.account = account
    }

    public struct Failure: Error, LocalizedError {
        public var status: OSStatus
        public var errorDescription: String? {
            (SecCopyErrorMessageString(status, nil) as String?) ?? "Keychain error \(status)"
        }
    }

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    public func read() -> String? {
        var query = self.query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
            let data = item as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func write(_ value: String) throws {
        let data = Data(value.utf8)
        let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw Failure(status: update) }
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else { throw Failure(status: status) }
    }

    public func delete() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure(status: status) }
    }
}
