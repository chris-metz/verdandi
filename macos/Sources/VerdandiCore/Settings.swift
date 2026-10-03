import CryptoKit
import Foundation

/// A tracked repository: its address when last seen, and GitHub's numeric ID,
/// which survives renames, once known.
public struct TrackedRepository: Hashable, Sendable, Identifiable {
  public var address: RepositoryAddress
  public var githubId: Int?

  public init(address: RepositoryAddress, githubId: Int? = nil) {
    self.address = address
    self.githubId = githubId
  }

  public var id: RepositoryAddress { address }
}

/// A named, saved issue search.
public struct SavedView: Hashable, Sendable, Identifiable {
  public var id: String
  public var name: String
  public var query: String

  public init(id: String = SavedView.newId(), name: String, query: String) {
    self.id = id
    self.name = name
    self.query = query
  }

  public static func newId() -> String {
    UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(12).description
  }
}

/// What settings.json holds: the tracked repositories and the views, in the
/// sidebar's order. The Electron app reads and writes the same file.
public struct Settings: Hashable, Sendable {
  public var repositories: [TrackedRepository]
  public var views: [SavedView]

  public init(repositories: [TrackedRepository] = [], views: [SavedView] = []) {
    self.repositories = repositories
    self.views = views
  }
}

public enum SettingsError: Error, LocalizedError {
  case invalid(String)

  public var errorDescription: String? {
    switch self {
    case .invalid(let message): "settings.json: \(message)"
    }
  }
}

/// Where Verdandi keeps its files, as the Electron app does.
public enum Directories {
  /// The directory `VERDANDI_HOME` names, for a profile other than the
  /// user's own, if it names one.
  public static var home: URL? {
    guard let home = ProcessInfo.processInfo.environment["VERDANDI_HOME"], !home.isEmpty else { return nil }
    return URL(fileURLWithPath: home).standardizedFileURL
  }

  /// `VERDANDI_HOME`, or Application Support.
  public static var userData: URL {
    home ?? FileManager.default.homeDirectoryForCurrentUser.appending(path: "Library/Application Support/Verdandi")
  }

  public static var settingsFile: URL { userData.appending(path: "settings.json") }
}

/// Reads and writes settings.json.
public struct SettingsFile: Sendable {
  public let url: URL

  public init(url: URL = Directories.settingsFile) {
    self.url = url
  }

  /// The settings, or empty ones while there is no file.
  public func read() throws -> Settings {
    try readIfPresent() ?? Settings()
  }

  /// The settings, or nil while there is no file.
  public func readIfPresent() throws -> Settings? {
    let data: Data
    do {
      data = try Data(contentsOf: url)
    } catch CocoaError.fileReadNoSuchFile {
      return nil
    }
    return try Self.parse(data)
  }

  public func write(_ settings: Settings) throws {
    try write(Self.serialized(settings), options: [.atomic])
  }

  /// Writes empty settings, unless there is a file already, which stays as
  /// it is.
  public func createIfMissing() throws {
    do {
      try write(Self.serialized(Settings()), options: [.withoutOverwriting])
    } catch CocoaError.fileWriteFileExists {
      return
    }
  }

  /// Writes the file, which only the user can read, in a folder only the
  /// user can open.
  private func write(_ data: Data, options: Data.WritingOptions) throws {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    try data.write(to: url, options: options)
    try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
  }

  /// The file's text for `settings`.
  static func serialized(_ settings: Settings) -> Data {
    let document = JSON.object([
      "version": 1,
      "repositories": .array(
        settings.repositories.map { repository in
          var entry: [String: JSON] = ["name": .string(repository.address.description)]
          if let id = repository.githubId { entry["id"] = JSON(id) }
          return .object(entry)
        }),
      "views": .array(
        settings.views.map { .object(["id": .string($0.id), "name": .string($0.name), "query": .string($0.query)]) }),
    ])
    var text = String(decoding: document.serialized(pretty: true), as: UTF8.self)
    text = Self.ordered(text)
    return Data((text + "\n").utf8)
  }

  static func parse(_ data: Data) throws -> Settings {
    guard let json = try? JSON(parsing: data), json.object != nil else {
      throw SettingsError.invalid("not a JSON object.")
    }
    guard let version = json["version"]?.int, version >= 0 else {
      throw SettingsError.invalid("version must be a non-negative integer.")
    }
    let repositories = try (json["repositories"]?.array ?? []).enumerated().map { index, entry in
      guard let address = entry["name"]?.string.flatMap(RepositoryAddress.init) else {
        throw SettingsError.invalid("repositories[\(index)].name is not \"owner/name\".")
      }
      return TrackedRepository(address: address, githubId: entry["id"]?.int)
    }
    let views = try (json["views"]?.array ?? []).enumerated().map { index, entry in
      guard let name = entry["name"]?.string, let query = entry["query"]?.string else {
        throw SettingsError.invalid("views[\(index)] needs a name and a query.")
      }
      // A view without an ID gets the one the Electron app would give it.
      let id =
        entry["id"]?.string
        ?? SHA256.hash(data: JSON.array([.string(name), .string(query), JSON(index)]).serialized())
        .map { String(format: "%02x", $0) }.joined().prefix(12).description
      return SavedView(id: id, name: name, query: query)
    }
    return Settings(repositories: repositories, views: views)
  }

  /// Puts `version` first, as the Electron app writes it, so diffs stay small.
  static func ordered(_ text: String) -> String {
    text.replacingOccurrences(of: "\"name\" : ", with: "\"name\": ")
      .replacingOccurrences(of: " : ", with: ": ")
  }
}
