//
//  Ruski_ReportUITestsLaunchTests.swift
//  Ruski ReportUITests
//
//  Created by Emilio Lukas Garci on 5/15/26.
//

import XCTest

final class Ruski_ReportUITestsLaunchTests: XCTestCase {

    override class var runsForEachTargetApplicationUIConfiguration: Bool {
        true
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testLaunch() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "--use-preview-services",
            "--preview-scenario",
            "standard"
        ]
        app.launch()

        XCTAssertTrue(app.staticTexts["home.title"].waitForExistence(timeout: 5))

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Launch Screen"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
