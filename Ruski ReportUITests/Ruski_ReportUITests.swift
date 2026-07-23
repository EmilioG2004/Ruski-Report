//
//  Ruski_ReportUITests.swift
//  Ruski ReportUITests
//

import XCTest

final class Ruski_ReportUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testNavigatesFromHomeToLiveMatch() throws {
        let app = launchPreviewApp()

        assertExists(app.staticTexts["home.title"])
        assertExists(app.buttons["home.tournamentCard"])
        app.buttons["home.tournamentCard"].tap()

        assertExists(app.descendants(matching: .any)["tournament.header"])
        assertExists(app.buttons["tournament.section.matches"])
        app.buttons["tournament.section.matches"].tap()

        let liveMatch = app.buttons["tournament.match.match-2026-001"]
        assertExists(liveMatch)
        liveMatch.tap()

        assertExists(app.scrollViews["match.detail"])
        assertExists(app.descendants(matching: .any)["match.scoreHeader"])
    }

    @MainActor
    func testShowsEmptyTournamentSections() throws {
        let app = launchPreviewApp(scenario: "empty")

        assertExists(app.buttons["home.tournamentCard"])
        app.buttons["home.tournamentCard"].tap()

        assertExists(app.buttons["tournament.section.pods"])
        app.buttons["tournament.section.pods"].tap()
        assertExists(app.staticTexts["Pods are not available yet"])

        app.buttons["tournament.section.matches"].tap()
        assertExists(app.staticTexts["Matches are not available yet"])
    }

    @MainActor
    func testShowsUnavailableTournamentState() throws {
        let app = launchPreviewApp(scenario: "unavailable")

        assertExists(app.staticTexts["Tournament unavailable"])
        assertExists(app.buttons["Retry"])
    }

    @MainActor
    func testShowsGuestAccountState() throws {
        let app = launchPreviewApp()

        openAccount(in: app)
        assertExists(app.descendants(matching: .any)["account.status.guest"])
        assertExists(app.textFields["account.displayName"])
    }

    @MainActor
    func testShowsAuthenticatedAccountState() throws {
        let app = launchPreviewApp(scenario: "authenticated")

        openAccount(in: app)
        assertExists(app.descendants(matching: .any)["account.status.authenticated"])
        assertExists(app.buttons["account.signOut"])
        assertExists(app.buttons["account.delete"])
    }

    @MainActor
    func testCancelsAccountDeletion() throws {
        let app = launchPreviewApp(scenario: "authenticated")

        openAccount(in: app)
        app.buttons["account.delete"].tap()

        let cancelButton = app.buttons["account.delete.cancel"]
        assertExists(cancelButton)
        cancelButton.tap()

        assertExists(app.descendants(matching: .any)["account.status.authenticated"])
        assertExists(app.buttons["account.delete"])
    }

    @MainActor
    func testConfirmsAccountDeletionAndReturnsToGuestState() throws {
        let app = launchPreviewApp(scenario: "authenticated")

        openAccount(in: app)
        app.buttons["account.delete"].tap()

        let confirmButton = app.buttons["account.delete.confirm"]
        assertExists(confirmButton)
        confirmButton.tap()

        assertExists(app.descendants(matching: .any)["account.status.guest"])
        assertExists(app.descendants(matching: .any)["account.deletion.success"])
        assertExists(app.textFields["account.displayName"])
    }

    @MainActor
    private func launchPreviewApp(scenario: String = "standard") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "--use-preview-services",
            "--preview-scenario",
            scenario
        ]
        app.launch()
        return app
    }

    @MainActor
    private func openAccount(in app: XCUIApplication) {
        let accountButton = app.buttons["account.toolbar"]
        assertExists(accountButton)
        accountButton.tap()
        assertExists(app.navigationBars["Account"])
    }

    @MainActor
    private func assertExists(
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
}
