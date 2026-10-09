import Foundation

/// One request to GitHub's API, as the core's host sends it
/// (`GitHubRequest` in `apps/ios/host/native.ts`).
public struct GitHubRequest: Codable, Hashable, Sendable {
    public var method: String
    /// Relative to `https://api.github.com/`, e.g. `graphql`.
    public var path: String
    /// Query parameters, in order, unencoded.
    public var query: [[String]]
    public var body: String?

    public init(method: String, path: String, query: [[String]] = [], body: String? = nil) {
        self.method = method
        self.path = path
        self.query = query
        self.body = body
    }
}

/// What became of a request to GitHub's API (`GitHubOutcome`).
public enum GitHubOutcome: Encodable, Hashable, Sendable {
    case response(status: Int, headers: [[String]], body: String)
    case signedOut
    case unreachable(message: String)

    private enum CodingKeys: String, CodingKey { case kind, status, headers, body, message }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .response(let status, let headers, let body):
            try c.encode("response", forKey: .kind)
            try c.encode(status, forKey: .status)
            try c.encode(headers, forKey: .headers)
            try c.encode(body, forKey: .body)
        case .signedOut:
            try c.encode("signed-out", forKey: .kind)
        case .unreachable(let message):
            try c.encode("unreachable", forKey: .kind)
            try c.encode(message, forKey: .message)
        }
    }
}

/// How the core reaches GitHub: requests sent with the app's token, which
/// the core never sees.
public protocol GitHubTransport: Sendable {
    func send(_ request: GitHubRequest) async -> GitHubOutcome
    /// Where the token comes from, or none without one.
    func tokenSource() -> TokenSource?
}

/// GitHub's API over HTTPS, with the token `credentials` hold.
public final class GitHubAPI: GitHubTransport {
    private let credentials: Credentials
    private let session: URLSession
    private let base = URL(string: "https://api.github.com/")!

    public init(credentials: Credentials) {
        self.credentials = credentials
        // gh caches nothing either: every read asks GitHub.
        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 60
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration)
    }

    public func tokenSource() -> TokenSource? {
        credentials.current?.source
    }

    public func send(_ request: GitHubRequest) async -> GitHubOutcome {
        guard let token = credentials.current else { return .signedOut }
        guard let url = url(for: request) else {
            return .unreachable(message: "The request to \(request.path) has no valid address.")
        }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = request.method
        urlRequest.setValue("Bearer \(token.value)", forHTTPHeaderField: "Authorization")
        urlRequest.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        urlRequest.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        urlRequest.setValue("Verdandi-iOS", forHTTPHeaderField: "User-Agent")
        if let body = request.body {
            urlRequest.httpBody = Data(body.utf8)
            urlRequest.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        }
        do {
            let (data, response) = try await session.data(for: urlRequest)
            guard let http = response as? HTTPURLResponse else {
                return .unreachable(message: "GitHub's answer was not HTTP.")
            }
            let headers = http.allHeaderFields.compactMap { name, value -> [String]? in
                guard let name = name as? String else { return nil }
                return [name, "\(value)"]
            }
            return .response(status: http.statusCode, headers: headers, body: String(decoding: data, as: UTF8.self))
        } catch {
            return .unreachable(message: error.localizedDescription)
        }
    }

    /// The request's address, its query encoded as GitHub reads it: a `+`
    /// in a search stays a `+`, not a space.
    func url(for request: GitHubRequest) -> URL? {
        guard var components = URLComponents(url: base.appending(path: request.path), resolvingAgainstBaseURL: false)
        else { return nil }
        if !request.query.isEmpty {
            components.percentEncodedQuery = request.query.compactMap { pair in
                guard let name = pair.first, pair.count == 2 else { return nil }
                return "\(Self.encode(name))=\(Self.encode(pair[1]))"
            }.joined(separator: "&")
        }
        return components.url
    }

    private static let unreserved = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")

    static func encode(_ text: String) -> String {
        text.addingPercentEncoding(withAllowedCharacters: unreserved) ?? text
    }
}
