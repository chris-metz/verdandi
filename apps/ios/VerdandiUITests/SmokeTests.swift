import XCTest

/// The ways through the app every user takes, tapped as a user taps them,
/// on whichever device the tests run: an iPhone shows one column at a time,
/// an iPad three. They read the real GitHub, chris-metz/verdandi, whose
/// closed issues and their relationships stay as they are.
final class SmokeTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var isPhone: Bool { UIDevice.current.userInterfaceIdiom == .phone }

    /// Launches with chris-metz/verdandi tracked and its list shown.
    @MainActor
    private func launchOnVerdandi(_ more: [String: String] = [:]) -> XCUIApplication {
        launchVerdandi(
            [
                "VERDANDI_TRACK": "chris-metz/verdandi",
                "VERDANDI_SELECT": "repo:chris-metz/verdandi",
            ].merging(more) { $1 })
    }

    /// Goes back one screen in the column on top, as the back button does.
    @MainActor
    private func back(_ app: XCUIApplication) {
        app.navigationBars.buttons.element(boundBy: 0).tap()
    }

    /// Brings the sidebar into sight: back to it on an iPhone, and on an
    /// iPad in portrait, where it hides, with the bar's sidebar button.
    @MainActor
    private func showSidebar(_ app: XCUIApplication) {
        if isPhone {
            back(app)
            return
        }
        let settings = app.buttons["Settings"].firstMatch
        if settings.waitForExistence(timeout: 2), settings.isHittable { return }
        app.buttons["Show Sidebar"].firstMatch.await().tap()
    }

    @MainActor
    func testOpensAnIssueFromARepositorysList() {
        let app = launchOnVerdandi()
        let row = app.staticTexts["Sign the Windows app, so Windows doesn't warn before it starts"]
        row.await(60)
        snap("list")
        row.tap()
        app.staticTexts["chris-metz/verdandi#83"].await()
        snap("issue")
    }

    @MainActor
    func testFollowsTheBlockingMapToABlocker() {
        let app = launchOnVerdandi(["VERDANDI_ISSUE": "chris-metz/verdandi#8"])
        app.staticTexts["Decide between live GitHub queries and a local mirror"].await(60)
        // #8 is blocked by #5; its card names it by number.
        let blocker = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Research GitHub's API")).firstMatch
        blocker.await(60)
        snap("map")
        blocker.tap()
        app.staticTexts["chris-metz/verdandi#5"].await()
        snap("blocker")
        back(app)
        app.staticTexts["Decide between live GitHub queries and a local mirror"].await()
    }

    @MainActor
    func testSwitchesAListToItsClosedIssues() {
        let app = launchOnVerdandi()
        app.buttons["Closed"].await(60).tap()
        app.staticTexts["Keep the sidebar hidden or shown across launches, in the macOS app"].await(90)
        snap("closed")
        app.buttons["Open"].tap()
        app.staticTexts["Sign the Windows app, so Windows doesn't warn before it starts"].await(60)
    }

    @MainActor
    func testFiltersAListByALabel() {
        let app = launchOnVerdandi()
        app.staticTexts["Sign the Windows app, so Windows doesn't warn before it starts"].await(60)
        app.buttons["Filter by enhancement"].firstMatch.await().tap()
        app.buttons["Clear label filter"].await()
        snap("filtered")
        XCTAssertFalse(app.staticTexts["search button"].exists, "an issue without the label still shows")
        app.buttons["Clear label filter"].tap()
        app.staticTexts["search button"].await()
    }

    @MainActor
    func testGoesToAnIssueByItsReference() {
        let app = launchOnVerdandi()
        app.buttons["Go to Issue"].await(60).tap()
        let field = app.searchFields.firstMatch.await()
        field.typeText("chris-metz/verdandi#8\n")
        app.staticTexts["Decide between live GitHub queries and a local mirror"].await(60)
        snap("gone-to")
    }

    @MainActor
    func testShowsTheAccountInSettings() {
        let app = launchOnVerdandi()
        app.staticTexts["Sign the Windows app, so Windows doesn't warn before it starts"].await(60)
        showSidebar(app)
        app.buttons["Settings"].firstMatch.await().tap()
        app.staticTexts["@chris-metz"].await()
        app.buttons["Dark"].tap()
        snap("settings-dark")
        app.buttons["System"].tap()
    }

    @MainActor
    func testAddsARepositoryByItsAddress() {
        let app = launchOnVerdandi()
        app.staticTexts["Sign the Windows app, so Windows doesn't warn before it starts"].await(60)
        showSidebar(app)
        app.buttons["Add Repository"].firstMatch.await().tap()
        let field = app.searchFields.firstMatch.await()
        field.tap()
        field.typeText("chris-metz/pacemark")
        // Once GitHub has found it, the typed address is offered and ticked.
        app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Add Repository")).firstMatch.await(60)
        snap("picker")
        field.typeText("\n")
        app.staticTexts["pacemark"].await(60)
        snap("added")
    }

    @MainActor
    func testSavesAView() {
        let app = launchOnVerdandi()
        app.staticTexts["Sign the Windows app, so Windows doesn't warn before it starts"].await(60)
        showSidebar(app)
        app.buttons["New View"].firstMatch.await().tap()
        let name = app.textFields["Name"].await()
        name.tap()
        name.typeText("Closed decisions")
        let search = app.textFields["GitHub search"].await()
        search.tap()
        search.typeText("repo:chris-metz/verdandi is:issue is:closed \"Decide\"")
        snap("view-editor")
        app.buttons["Save"].tap()
        app.staticTexts["Decide between live GitHub queries and a local mirror"].await(90)
        snap("view")
    }
}
