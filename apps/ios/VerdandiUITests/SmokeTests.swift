import XCTest

/// The way through the app every user takes: a list, an issue, the issues
/// around it, and back.
final class SmokeTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testOpensAnIssueFromARepositorysList() {
        let app = launchVerdandi([
            "VERDANDI_TRACK": "chris-metz/verdandi",
            "VERDANDI_SELECT": "repo:chris-metz/verdandi",
        ])
        let row = app.staticTexts["Sign the Windows app, so Windows doesn't warn before it starts"]
        row.await(60)
        snap("list")
        row.tap()
        app.staticTexts["chris-metz/verdandi#83"].await()
        snap("issue")
    }
}
