import Foundation
import Synchronization
import Testing

@testable import VerdandiCore

/// Answers the loader's requests instead of the network, by host: each test
/// answers for a host of its own, so that tests run side by side.
final class StubNetwork: URLProtocol {
  struct Answer: Sendable {
    var status = 200
    var headers: [String: String] = [:]
    var body = Data()
  }

  typealias Server = @Sendable (URLRequest) -> Answer

  private static let servers = Mutex<[String: Server]>([:])

  /// A host only `server` answers for, and records the requests it gets.
  static func serve(_ server: @escaping Server) -> String {
    let host = "\(UUID().uuidString.lowercased()).test"
    servers.withLock { $0[host] = server }
    return host
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    guard let url = request.url, let server = Self.servers.withLock({ $0[url.host() ?? ""] }) else {
      client?.urlProtocol(self, didFailWithError: URLError(.cannotFindHost))
      return
    }
    let answer = server(request)
    let response = HTTPURLResponse(url: url, statusCode: answer.status, httpVersion: "HTTP/1.1", headerFields: answer.headers)!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: answer.body)
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}

private let loader = ImageLoader(protocolClasses: [StubNetwork.self])

/// The first bytes of a PNG, enough to stand for one.
private let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

private func url(_ host: String, _ path: String = "/a.png") -> URL { URL(string: "https://\(host)\(path)")! }

@Test func loadsAnImage() async {
  let host = StubNetwork.serve { _ in .init(headers: ["Content-Type": "image/png"], body: png) }

  #expect(await loader.load(url(host)) == .loaded(png, type: "image/png"))
}

@Test func loadsNothingButHTTPSAddressesWithoutCredentials() async {
  let requests = Mutex(0)
  let host = StubNetwork.serve { _ in
    requests.withLock { $0 += 1 }
    return .init(headers: ["Content-Type": "image/png"], body: png)
  }

  for address in ["http://\(host)/a.png", "https://octo:secret@\(host)/a.png", "https://octo@\(host)/a.png"] {
    #expect(await loader.load(URL(string: address)!) == .failed("Not an https:// address"))
  }
  #expect(requests.withLock { $0 } == 0)
}

@Test func followsRedirectsOnlyToHTTPSAddresses() async {
  let image = StubNetwork.serve { _ in .init(headers: ["Content-Type": "image/png"], body: png) }
  let host = StubNetwork.serve { request in
    switch request.url?.path() {
    case "/moved": .init(status: 301, headers: ["Location": "/elsewhere"])
    case "/elsewhere": .init(status: 302, headers: ["Location": "https://\(image)/a.png"])
    case "/insecure": .init(status: 302, headers: ["Location": "http://\(image)/a.png"])
    default: .init(status: 404)
    }
  }

  #expect(await loader.load(url(host, "/moved")) == .loaded(png, type: "image/png"))
  #expect(await loader.load(url(host, "/insecure")) == .failed("Not an https:// address"))
}

@Test func followsAtMostFiveRedirects() async {
  let host = StubNetwork.serve { request in
    let step = Int(request.url?.lastPathComponent ?? "") ?? 0
    return step == 6
      ? .init(headers: ["Content-Type": "image/png"], body: png)
      : .init(status: 302, headers: ["Location": "\(step + 1)"])
  }

  #expect(await loader.load(url(host, "/1")) == .loaded(png, type: "image/png"))
  #expect(await loader.load(url(host, "/0")) == .failed("Too many redirects"))
}

@Test func saysWhyAnAnswerIsNoImage() async {
  let host = StubNetwork.serve { request in
    switch request.url?.path() {
    case "/page": .init(headers: ["Content-Type": "text/html; charset=utf-8"], body: Data("<p>".utf8))
    case "/svg": .init(headers: ["content-type": "Image/SVG+XML; charset=utf-8"], body: Data("<svg/>".utf8))
    default: .init(status: 404)
    }
  }

  #expect(await loader.load(url(host, "/gone")) == .failed("\(host) answered HTTP 404"))
  #expect(await loader.load(url(host, "/page")) == .failed("Not an image"))
  #expect(await loader.load(url(host, "/svg")) == .loaded(Data("<svg/>".utf8), type: "Image/SVG+XML"))
  #expect(await loader.load(url("nowhere.test")) == .failed("Cannot reach nowhere.test"))
}

@Test func loadsImagesOfAtMostTenMegabytes() async {
  let limit = 10 * 1024 * 1024
  let host = StubNetwork.serve { request in
    switch request.url?.path() {
    case "/limit": .init(headers: ["Content-Type": "image/png"], body: Data(count: limit))
    // Without saying how large, as a streamed answer does.
    case "/over": .init(headers: ["Content-Type": "image/png"], body: Data(count: limit + 1))
    default: .init(headers: ["Content-Type": "image/png", "Content-Length": "\(limit + 1)"], body: png)
    }
  }

  #expect(await loader.load(url(host, "/limit")) == .loaded(Data(count: limit), type: "image/png"))
  #expect(await loader.load(url(host, "/over")) == .failed("Larger than 10 MB"))
  #expect(await loader.load(url(host, "/announced")) == .failed("Larger than 10 MB"))
}

@Test func asksForAnImageWithoutCookiesCredentialsOrReferrer() async throws {
  let requests = Mutex<[URLRequest]>([])
  let host = StubNetwork.serve { request in
    requests.withLock { $0.append(request) }
    return request.url?.path() == "/a.png"
      ? .init(headers: ["Content-Type": "image/png"], body: png)
      : .init(status: 302, headers: ["Location": "/a.png", "Set-Cookie": "session=1; Path=/; Secure"])
  }
  // A cookie the system keeps for the host, as a browser would.
  let cookie = try #require(
    HTTPCookie(properties: [.domain: host, .path: "/", .name: "kept", .value: "1", .secure: "TRUE"]))
  HTTPCookieStorage.shared.setCookie(cookie)
  defer { HTTPCookieStorage.shared.deleteCookie(cookie) }

  #expect(await loader.load(url(host, "/moved")) == .loaded(png, type: "image/png"))
  let sent = requests.withLock { $0 }
  #expect(sent.count == 2)
  for request in sent {
    #expect(request.value(forHTTPHeaderField: "Accept") == "image/*")
    for header in ["Cookie", "Authorization", "Referer"] {
      #expect(request.value(forHTTPHeaderField: header) == nil, "\(header)")
    }
  }
}

/// Loads a real image through GitHub's redirect to another host:
/// `VERDANDI_LIVE=1 swift test`.
@Test(.enabled(if: ProcessInfo.processInfo.environment["VERDANDI_LIVE"] == "1"))
func loadsARealImageThroughARedirect() async throws {
  let address = try #require(URL(string: "https://github.com/chris-metz/verdandi/raw/main/docs/social-preview.png"))
  guard case .loaded(let data, let type) = await ImageLoader().load(address) else {
    Issue.record("not loaded")
    return
  }
  #expect(type == "image/png")
  #expect(data.starts(with: png))
}
