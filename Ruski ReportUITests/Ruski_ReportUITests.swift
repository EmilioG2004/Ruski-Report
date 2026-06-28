//
//  Ruski_ReportUITests.swift
//  Ruski ReportUITests
//
//  Created by Emilio Lukas Garci on 5/15/26.
//

import XCTest

final class Ruski_ReportUITests: XCTestCase {

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.

        // In UI tests it is usually best to stop immediately when a failure occurs.
        continueAfterFailure = false

        // In UI tests it’s important to set the initial state - such as interface orientation - required for your tests before they run. The setUp method is a good place to do this.
    }

    override func tearDownWithError() throws {
        // Put teardown code here. This method is called after the invocation of each test method in the class.
    }

    @MainActor
    func testExample() throws {
        let app = launchPreviewApp()

        XCTAssertTrue(app.staticTexts["home.title"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["2026 Ruski Tournament"].exists)
    }

    @MainActor
    func testLaunchPerformance() throws {
        // This measures how long it takes to launch your application.
        measure(metrics: [XCTApplicationLaunchMetric()]) {
            _ = launchPreviewApp()
        }
    }

    @MainActor
    private func launchPreviewApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments.append("--use-preview-services")
        app.launch()
        return app
    }
}
