import Foundation

/// An image loaded from elsewhere than GitHub's media hosts, or why it
/// could not be, in a few words.
public enum LoadedImage: Equatable, Sendable {
  /// Its bytes, and their type, e.g. `image/png`.
  case loaded(Data, type: String)
  case failed(String)
}

/// Loads an image a body shows from elsewhere than GitHub's media hosts,
/// once the user asked (ADR 0003): only from `https://` addresses, redirects
/// included, without cookies, credentials or referrer, and keeping nothing
/// on disk. Only images of at most 10 MB are loaded.
public struct ImageLoader: Sendable {
  /// The most an image may weigh: GitHub's own limit for uploaded images.
  static let maxBytes = 10 * 1024 * 1024

  /// How many redirects are followed, each to another `https://` address.
  static let maxRedirects = 5

  /// How long loading an image may take, in seconds.
  static let timeout: TimeInterval = 30

  /// For tests: what answers instead of the network.
  private let protocolClasses: [AnyClass]

  public init() { self.init(protocolClasses: []) }

  init(protocolClasses: [AnyClass]) {
    self.protocolClasses = protocolClasses
  }

  public func load(_ url: URL) async -> LoadedImage {
    var address: URL? = url
    for _ in 0...Self.maxRedirects {
      guard let url = address, url.scheme?.lowercased() == "https", url.user() == nil, url.password() == nil,
        let host = url.host()
      else { return .failed("Not an https:// address") }
      switch await fetch(url) {
      case .redirect(let location):
        address = URL(string: location, relativeTo: url)?.absoluteURL
      case .status(let status): return .failed("\(host) answered HTTP \(status)")
      case .notImage: return .failed("Not an image")
      case .tooLarge: return .failed("Larger than 10 MB")
      case .unreachable: return .failed("Cannot reach \(host)")
      case .image(let data, let type): return .loaded(data, type: type)
      }
    }
    return .failed("Too many redirects")
  }

  /// One request, without following its redirect, in a session of its
  /// own that shares nothing with the system's or the web views'.
  private func fetch(_ url: URL) async -> Download.Outcome {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.httpCookieAcceptPolicy = .never
    configuration.urlCredentialStorage = nil
    configuration.urlCache = nil
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.timeoutIntervalForRequest = Self.timeout
    configuration.timeoutIntervalForResource = Self.timeout
    configuration.protocolClasses = protocolClasses + (configuration.protocolClasses ?? [])
    let download = Download()
    let session = URLSession(configuration: configuration, delegate: download, delegateQueue: nil)
    defer { session.finishTasksAndInvalidate() }
    var request = URLRequest(url: url)
    request.setValue("image/*", forHTTPHeaderField: "Accept")
    return await download.run(request, in: session)
  }
}

/// One request, read as it arrives.
private final class Download: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  enum Outcome {
    /// A redirect to its `Location`, which may be relative.
    case redirect(String)
    /// Another HTTP status than success or a redirect.
    case status(Int)
    case notImage
    /// Larger than `ImageLoader.maxBytes`.
    case tooLarge
    case unreachable
    case image(Data, type: String)
  }

  // The session calls its delegate one call at a time, on its queue.
  private var continuation: CheckedContinuation<Outcome, Never>?
  /// How the request ended before its body was read, if it did.
  private var outcome: Outcome?
  private var data = Data()
  private var type = ""

  func run(_ request: URLRequest, in session: URLSession) async -> Outcome {
    await withCheckedContinuation { continuation in
      self.continuation = continuation
      session.dataTask(with: request).resume()
    }
  }

  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    let http = response as? HTTPURLResponse
    let status = http?.statusCode ?? 0
    type = http?.value(forHTTPHeaderField: "Content-Type")?.split(separator: ";").first?
      .trimmingCharacters(in: .whitespaces) ?? ""
    if (300..<400).contains(status), let location = http?.value(forHTTPHeaderField: "Location") {
      outcome = .redirect(location)
    } else if !(200..<300).contains(status) {
      outcome = .status(status)
    } else if !type.lowercased().hasPrefix("image/") {
      outcome = .notImage
    } else if response.expectedContentLength > ImageLoader.maxBytes {
      outcome = .tooLarge
    }
    completionHandler(outcome == nil ? .allow : .cancel)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard outcome == nil else { return }
    if self.data.count + data.count > ImageLoader.maxBytes {
      outcome = .tooLarge
      self.data = Data()
      dataTask.cancel()
    } else {
      self.data.append(data)
    }
  }

  /// Redirects come back as answers, for `ImageLoader` to check.
  func urlSession(
    _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }

  /// Answers no server's request for credentials, so that none the system
  /// keeps, e.g. for Kerberos, are sent.
  func urlSession(
    _ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust {
      completionHandler(.performDefaultHandling, nil)
    } else {
      completionHandler(.rejectProtectionSpace, nil)
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
    continuation?.resume(returning: outcome ?? (error == nil ? .image(data, type: type) : .unreachable))
    continuation = nil
  }
}
