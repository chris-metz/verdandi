import XCTest

/// How the window lays itself out as an iPad turns: three columns in
/// landscape, the issue page beside the list.
final class LayoutTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    override func tearDown() {
        XCUIDevice.shared.orientation = .portrait
    }

    @MainActor
    func testShowsTheIssueBesideTheListInLandscape() throws {
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom != .pad, "Only an iPad shows three columns.")
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = launchVerdandi([
            "VERDANDI_TRACK": "chris-metz/verdandi",
            "VERDANDI_SELECT": "repo:chris-metz/verdandi",
            "VERDANDI_ISSUE": "chris-metz/verdandi#8",
        ])
        app.staticTexts["Decide between live GitHub queries and a local mirror"].await(60)
        app.staticTexts["Sign the Windows app, so Windows doesn't warn before it starts"].await(60)
        sleep(4)
        snap("landscape")
    }
}
