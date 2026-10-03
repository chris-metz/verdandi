import Foundation
import Testing

@testable import VerdandiCore

/// A settings.json in a folder of its own, which the test removes.
private func temporarySettingsFile() -> SettingsFile {
  SettingsFile(
    url: FileManager.default.temporaryDirectory.appending(path: "verdandi-\(UUID().uuidString)/settings.json"))
}

@Test func tellsAMissingSettingsFileFromAnEmptyOne() throws {
  let file = temporarySettingsFile()
  defer { try? FileManager.default.removeItem(at: file.url.deletingLastPathComponent()) }

  #expect(try file.readIfPresent() == nil)
  #expect(try file.read() == Settings())

  try file.write(Settings())
  #expect(try file.readIfPresent() == Settings())
}

@Test func anExistingSettingsFileThatCannotBeReadIsNoMissingOne() throws {
  let file = temporarySettingsFile()
  defer { try? FileManager.default.removeItem(at: file.url.deletingLastPathComponent()) }
  try file.write(Settings())
  try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: file.url.path)

  #expect(throws: (any Error).self) { try file.readIfPresent() }
  #expect(throws: (any Error).self) { try file.read() }
}

@Test func createsAnEmptySettingsFileWhileThereIsNone() throws {
  let file = temporarySettingsFile()
  defer { try? FileManager.default.removeItem(at: file.url.deletingLastPathComponent()) }

  try file.createIfMissing()

  let written = try JSONSerialization.jsonObject(with: Data(contentsOf: file.url)) as? NSDictionary
  #expect(written == ["version": 1, "repositories": [], "views": []])
}

@Test func leavesAnExistingSettingsFileAsItIs() throws {
  let file = temporarySettingsFile()
  defer { try? FileManager.default.removeItem(at: file.url.deletingLastPathComponent()) }
  let text = #"{"version": 1, "repositories": [{"name": "acme/api"}]}"#
  try FileManager.default.createDirectory(at: file.url.deletingLastPathComponent(), withIntermediateDirectories: true)
  try Data(text.utf8).write(to: file.url)

  try file.createIfMissing()

  #expect(try String(contentsOf: file.url, encoding: .utf8) == text)
}
