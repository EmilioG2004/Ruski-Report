//
//  PreviewAppUITestCase.swift
//  Ruski ReportUITests
//
//  Owns deterministic app launch, scrolling, and assertions shared by the
//  focused UI qualification suites. Navigation lives in a focused extension.
//

import XCTest

class PreviewAppUITestCase: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func launchPreviewApp(
        scenario: String = "standard",
        additionalArguments: [String] = []
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "--use-preview-services",
            "--preview-scenario",
            scenario
        ] + additionalArguments
        app.launch()
        return app
    }

    @MainActor
    func assertPolicyLinksExist(in app: XCUIApplication) {
        assertExists(app.descendants(matching: .any)["account.policy.privacy"])
        assertExists(app.descendants(matching: .any)["account.policy.support"])
        assertExists(app.descendants(matching: .any)["account.policy.community"])
    }

    @MainActor
    func scrollUntilHittable(
        _ element: XCUIElement,
        in scrollView: XCUIElement,
        attempts: Int = 6
    ) {
        for _ in 0..<attempts where !element.isHittable {
            scrollView.swipeUp()
        }
        XCTAssertTrue(element.isHittable, "Expected element to become hittable")
    }

    @MainActor
    func assertExists(
        _ element: XCUIElement,
        timeout: TimeInterval = 5,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertTrue(
            element.waitForExistence(timeout: timeout),
            "Expected \(element) to exist",
            file: file,
            line: line
        )
    }

    @MainActor
    func assertDisappears(
        _ element: XCUIElement,
        timeout: TimeInterval = 5,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: element
        )
        let result = XCTWaiter.wait(for: [expectation], timeout: timeout)
        XCTAssertEqual(
            result,
            .completed,
            "Expected \(element) to disappear",
            file: file,
            line: line
        )
    }

    @MainActor
    func assertHasAccessibleLabel(
        _ element: XCUIElement,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        assertExists(element, file: file, line: line)
        XCTAssertFalse(
            element.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            "Expected \(element) to have an accessibility label",
            file: file,
            line: line
        )
    }
}
