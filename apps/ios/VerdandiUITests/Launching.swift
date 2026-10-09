import XCTest

/// Launches the app for a UI test, signed in with the token
/// `scripts/ui-test.sh` left in the app's folder, which each launch keeps
/// for the next; in a fresh profile unless the test names one; and with the
/// launch options it asks for.
@MainActor
func launchVerdandi(_ options: [String: String] = [:]) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchEnvironment["VERDANDI_KEEP_DEV_TOKEN"] = "1"
    app.launchEnvironment["VERDANDI_HOME"] = "fresh"
    for (name, value) in options { app.launchEnvironment[name] = value }
    app.launch()
    return app
}

extension XCTestCase {
    /// Keeps a screenshot of the app in the test's results, by name;
    /// `scripts/ui-test.sh` saves them as PNG files.
    @MainActor
    func snap(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

extension XCUIElement {
    /// Waits for it to exist, failing the test with what was looked for.
    @discardableResult
    func await(_ seconds: TimeInterval = 30, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        if !waitForExistence(timeout: seconds) {
            XCTFail("Not found in \(Int(seconds)) s: \(self)", file: file, line: line)
        }
        return self
    }
}
