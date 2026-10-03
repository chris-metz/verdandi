import Foundation
import Testing

@testable import Verdandi
@testable import VerdandiCore

/// The first launch: without settings.json, the repository picker opens on
/// its own once gh works.
@MainActor
struct FirstLaunchTests {
  /// A settings.json in a folder of its own, not there yet.
  private let file = SettingsFile(
    url: FileManager.default.temporaryDirectory.appending(path: "verdandi-\(UUID().uuidString)/settings.json"))

  /// Removes the settings.json and its folder.
  private func cleanUp() {
    try? FileManager.default.removeItem(at: file.url.deletingLastPathComponent())
  }

  @Test func opensThePickerOnceGhWorksWhileThereIsNoSettingsFile() {
    defer { cleanUp() }
    let model = AppModel(settingsFile: file)

    model.pretendSetup(.signedOut)
    #expect(model.sheet == nil)

    model.pretendSetup(.ready(login: "octo"))
    #expect(model.sheet == .repositoryPicker)

    // Closed, it stays closed as gh is checked again.
    model.sheet = nil
    model.pretendSetup(.checking)
    model.pretendSetup(.ready(login: "octo"))
    #expect(model.sheet == nil)
  }

  @Test func anExistingSettingsFileKeepsThePickerClosed() throws {
    defer { cleanUp() }
    try file.write(Settings())
    let tracksNothing = AppModel(settingsFile: file)
    tracksNothing.pretendSetup(.ready(login: "octo"))
    #expect(tracksNothing.sheet == nil)

    try Data("{ not json".utf8).write(to: file.url)
    let cannotBeRead = AppModel(settingsFile: file)
    cannotBeRead.pretendSetup(.ready(login: "octo"))
    #expect(cannotBeRead.settingsProblem != nil)
    #expect(cannotBeRead.sheet == nil)
  }

  @Test func aSettingsFileMadeWhileTheSetupScreenShowsKeepsThePickerClosed() throws {
    defer { cleanUp() }
    let model = AppModel(settingsFile: file)
    model.pretendSetup(.signedOut)

    try file.write(Settings())
    model.pretendSetup(.ready(login: "octo"))

    #expect(model.sheet == nil)
  }

  @Test func skippingThePickerWritesAnEmptySettingsFileSoItDoesNotOpenAgain() throws {
    defer { cleanUp() }
    let model = AppModel(settingsFile: file)
    model.pretendSetup(.ready(login: "octo"))

    model.skipRepositoryPicker()

    #expect(try file.readIfPresent() == Settings())
    #expect(!model.isFirstLaunch)
    let next = AppModel(settingsFile: file)
    next.pretendSetup(.ready(login: "octo"))
    #expect(next.sheet == nil)
  }

  @Test func addingRepositoriesWritesTheSettingsFileAndEndsTheFirstLaunch() throws {
    defer { cleanUp() }
    let model = AppModel(settingsFile: file)
    let api = TrackedRepository(address: RepositoryAddress(owner: "acme", name: "api"), githubId: 7)

    model.changeSettings { $0.track([api]) }

    #expect(try file.readIfPresent()?.repositories == [api])
    #expect(!model.isFirstLaunch)
  }
}
