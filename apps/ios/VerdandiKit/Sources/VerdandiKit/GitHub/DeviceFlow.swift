import Foundation

/// The code GitHub hands out for the device flow: the user types
/// `userCode` at `verificationURI` in a browser, while the app asks with
/// `deviceCode` whether they have authorized it.
public struct DeviceCode: Sendable, Equatable {
    public var deviceCode: String
    /// As GitHub shows it, e.g. `WDJB-MJHT`.
    public var userCode: String
    public var verificationURI: URL
    /// When the code stops working, about fifteen minutes on.
    public var expiresAt: Date
    /// How long to wait between two questions, in seconds.
    public var interval: Int

    public init(deviceCode: String, userCode: String, verificationURI: URL, expiresAt: Date, interval: Int) {
        self.deviceCode = deviceCode
        self.userCode = userCode
        self.verificationURI = verificationURI
        self.expiresAt = expiresAt
        self.interval = interval
    }
}

/// What one question about a device code got back.
public enum DeviceFlowPoll: Sendable, Equatable {
    /// The user authorized the app: here is its token.
    case token(String)
    /// Not yet.
    case pending
    /// Asked too often: wait this many seconds between questions from now
    /// on, or five more without a number.
    case slowDown(interval: Int?)
}

/// Why signing in with GitHub stopped, in a sentence for the user.
public enum DeviceFlowError: Error, Sendable, Equatable, LocalizedError {
    /// The code expired before the user entered it.
    case expired
    /// The user chose Cancel on GitHub.
    case denied
    /// The app's OAuth App does not allow the device flow.
    case disabled
    /// GitHub does not know the app's client ID.
    case unknownClient
    /// GitHub could not be reached.
    case unreachable(String)
    /// Any other answer, in GitHub's words where it gave some.
    case failed(String)

    public var errorDescription: String? {
        switch self {
        case .expired: "The code expired before it was entered on GitHub. Start again for a new one."
        case .denied: "Verdandi was not authorized on GitHub."
        case .disabled: "This build of Verdandi cannot sign in with GitHub: its OAuth App has the device flow turned off. Use a personal access token instead."
        case .unknownClient: "GitHub does not know this build's client ID. Use a personal access token instead."
        case .unreachable(let message): "GitHub could not be reached. \(message)"
        case .failed(let message): message
        }
    }
}

/// GitHub's device flow for an OAuth App: the app asks for a code, the user
/// enters it on github.com in any browser, and the app asks GitHub every
/// few seconds until it hands out a token. It needs no redirect back into
/// the app, and the token comes straight from GitHub.
public struct DeviceFlow: Sendable {
    /// What the app asks for: the same as a classic token, so that private
    /// repositories and organizations read as on the desktop.
    public static let scopes = "repo read:org"

    /// Sends a form to a github.com address and returns the HTTP status and
    /// body, or throws when GitHub could not be reached.
    public typealias Post = @Sendable (_ url: URL, _ form: [(String, String)]) async throws -> (status: Int, body: Data)
    /// Waits, or throws once cancelled.
    public typealias Sleep = @Sendable (_ seconds: Int) async throws -> Void

    public let clientID: String
    private let post: Post
    private let sleep: Sleep
    private let now: @Sendable () -> Date

    static let codeURL = URL(string: "https://github.com/login/device/code")!
    static let tokenURL = URL(string: "https://github.com/login/oauth/access_token")!
    static let grantType = "urn:ietf:params:oauth:grant-type:device_code"

    public init(
        clientID: String,
        post: @escaping Post = DeviceFlow.send,
        sleep: @escaping Sleep = { try await Task.sleep(for: .seconds($0)) },
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.clientID = clientID
        self.post = post
        self.sleep = sleep
        self.now = now
    }

    /// Asks GitHub for a code for the user to enter.
    public func requestCode() async throws(DeviceFlowError) -> DeviceCode {
        let answer = try await send(Self.codeURL, [("client_id", clientID), ("scope", Self.scopes)])
        return try Self.readCode(status: answer.status, body: answer.body, now: now())
    }

    /// Asks GitHub once whether the user has entered the code.
    public func poll(_ code: DeviceCode) async throws(DeviceFlowError) -> DeviceFlowPoll {
        let answer = try await send(
            Self.tokenURL,
            [("client_id", clientID), ("device_code", code.deviceCode), ("grant_type", Self.grantType)])
        return try Self.readPoll(status: answer.status, body: answer.body)
    }

    /// Asks GitHub at the interval it set until the user has authorized the
    /// app, and returns the token. It throws `CancellationError` once its
    /// task is cancelled, and stops by itself when the code expires.
    public func token(for code: DeviceCode) async throws -> String {
        var interval = max(code.interval, 1)
        while true {
            try await sleep(interval)
            try Task.checkCancellation()
            if now() >= code.expiresAt { throw DeviceFlowError.expired }
            switch try await poll(code) {
            case .token(let token): return token
            case .pending: continue
            case .slowDown(let next): interval = next ?? interval + 5
            }
        }
    }

    private func send(_ url: URL, _ form: [(String, String)]) async throws(DeviceFlowError) -> (status: Int, body: Data) {
        do {
            return try await post(url, form)
        } catch let error as DeviceFlowError {
            throw error
        } catch {
            throw .unreachable(error.localizedDescription)
        }
    }

    // MARK: - Reading GitHub's answers

    private struct CodeAnswer: Decodable {
        var device_code: String
        var user_code: String
        var verification_uri: String
        var expires_in: Int
        var interval: Int?
    }

    private struct TokenAnswer: Decodable {
        var access_token: String?
        var error: String?
        var error_description: String?
        var interval: Int?
    }

    /// Reads the answer to asking for a code.
    static func readCode(status: Int, body: Data, now: Date) throws(DeviceFlowError) -> DeviceCode {
        if let answer = try? JSONDecoder().decode(CodeAnswer.self, from: body), (200..<300).contains(status),
            let uri = URL(string: answer.verification_uri)
        {
            return DeviceCode(
                deviceCode: answer.device_code, userCode: answer.user_code, verificationURI: uri,
                expiresAt: now.addingTimeInterval(TimeInterval(answer.expires_in)), interval: answer.interval ?? 5)
        }
        throw failure(status: status, body: body)
    }

    /// Reads the answer to asking whether the user has entered the code.
    static func readPoll(status: Int, body: Data) throws(DeviceFlowError) -> DeviceFlowPoll {
        let answer = try? JSONDecoder().decode(TokenAnswer.self, from: body)
        if (200..<300).contains(status), let token = answer?.access_token, !token.isEmpty { return .token(token) }
        switch answer?.error {
        case "authorization_pending": return .pending
        case "slow_down": return .slowDown(interval: answer?.interval)
        default: throw failure(status: status, body: body)
        }
    }

    /// What an answer that is neither a code, a token nor a wait means.
    static func failure(status: Int, body: Data) -> DeviceFlowError {
        let answer = try? JSONDecoder().decode(TokenAnswer.self, from: body)
        switch answer?.error {
        case "expired_token", "token_expired": return .expired
        case "access_denied": return .denied
        case "device_flow_disabled": return .disabled
        case "incorrect_client_credentials", "unauthorized_client": return .unknownClient
        default: break
        }
        // An unknown client ID is a plain "Not Found".
        if status == 404 { return .unknownClient }
        if let description = answer?.error_description, !description.isEmpty { return .failed(description) }
        if let error = answer?.error, !error.isEmpty { return .failed("GitHub answered \(error).") }
        return .failed("GitHub answered with HTTP \(status).")
    }

    // MARK: - Sending

    /// Posts a form to github.com, asking for JSON, as GitHub's device flow
    /// takes it.
    public static let send: Post = { url, form in
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("Verdandi-iOS", forHTTPHeaderField: "User-Agent")
        request.httpBody = Data(formEncoded(form).utf8)
        let (data, response) = try await URLSession.shared.data(for: request)
        return ((response as? HTTPURLResponse)?.statusCode ?? 0, data)
    }

    /// `name=value&…`, each part percent-encoded as a form takes it.
    static func formEncoded(_ form: [(String, String)]) -> String {
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        func encode(_ text: String) -> String { text.addingPercentEncoding(withAllowedCharacters: allowed) ?? text }
        return form.map { "\(encode($0.0))=\(encode($0.1))" }.joined(separator: "&")
    }
}
