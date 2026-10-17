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

    /// Scrolled down and back up, a list shows its title and counts as
    /// before: a large title stayed shut under the bar, where it shook.
    @MainActor
    func testShowsTheTitleAndCountsAgainAtTheTop() {
        XCUIDevice.shared.orientation = .portrait
        // List Only, the list across the window, which an iPad upright
        // shows only so.
        let app = launchVerdandi(
            [
                "VERDANDI_TRACK": "chris-metz/verdandi,house-metz/videofant",
                "VERDANDI_SELECT": "all",
            ], layout: "listOnly")
        let counts = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'open issues ·'")).firstMatch
        counts.await(60)
        sleep(10)
        let bar = app.navigationBars["All"]
        let top = (bar: bar.frame, counts: counts.frame)
        let list = app.collectionViews.containing(NSPredicate(format: "label BEGINSWITH 'Filter by'")).firstMatch
        list.swipeUp(velocity: .fast)
        list.swipeUp(velocity: .fast)
        sleep(1)
        list.swipeDown(velocity: .fast)
        list.swipeDown(velocity: .fast)
        sleep(2)
        snap("back at the top")
        XCTAssertEqual(bar.frame, top.bar, "The bar is as it was.")
        XCTAssertEqual(counts.frame, top.counts, "The counts are where they were.")
        XCTAssertTrue(counts.isHittable, "The counts are in sight.")
    }
}
