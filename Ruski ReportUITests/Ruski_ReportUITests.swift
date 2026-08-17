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

        assertExists(app.descendants(matching: .any)["match.detail"])
        assertExists(app.descendants(matching: .any)["match.scoreHeader"])
    }

    @MainActor
    func testOpensLiveGameFromHomeScoreFeed() throws {
        let app = launchPreviewApp()

        let liveMatch = app.buttons["home.match.match-2026-001"]
        assertExists(liveMatch)
        liveMatch.tap()

        assertExists(app.descendants(matching: .any)["match.scoreHeader"])
        assertExists(app.descendants(matching: .any)["match.panelPicker"])
        assertExists(app.descendants(matching: .any)["match.overview"])
    }

    @MainActor
    func testSwitchesBetweenMatchPanels() throws {
        let app = launchPreviewApp()

        openLiveMatch(in: app)
        assertExists(app.descendants(matching: .any)["match.overview"])

        app.buttons["match.panel.plays"].tap()
        assertExists(app.descendants(matching: .any)["match.events"])

        app.buttons["match.panel.scorecard"].tap()
        assertExists(app.descendants(matching: .any)["match.scorecard"])

        app.buttons["match.panel.chat"].tap()
        assertExists(app.buttons["match.comments.signIn"])
    }

    @MainActor
    func testLongNamesRemainNavigable() throws {
        let app = launchPreviewApp(scenario: "longContent")

        assertExists(
            app.staticTexts[
                "North Durham Longtable Society of Extremely Confident Shooters"
            ]
        )
        app.buttons["home.match.match-2026-001"].tap()

        assertExists(app.descendants(matching: .any)["match.scoreHeader"])
        assertExists(app.buttons["match.panel.scorecard"])
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
        assertExists(app.staticTexts["Games are not available yet"])
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
        assertPolicyLinksExist(in: app)
    }

    @MainActor
    func testShowsAuthenticatedAccountState() throws {
        let app = launchPreviewApp(scenario: "authenticated")

        openAccount(in: app)
        assertExists(app.descendants(matching: .any)["account.status.authenticated"])
        assertExists(app.buttons["account.signOut"])
        assertExists(app.buttons["account.delete"])
        assertPolicyLinksExist(in: app)
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
    func testShowsSafeModerationErrorAndPreservesDraft() throws {
        let app = launchPreviewApp(scenario: "moderationRejected")

        openComments(in: app)
        let scrollView = app.scrollViews["match.comments.scroll"]
        let input = app.textFields["match.comments.input"]
        scrollUntilHittable(input, in: scrollView)
        input.tap()
        input.typeText("Rejected draft")

        let postButton = app.buttons["match.comments.post"]
        assertExists(postButton)
        postButton.tap()

        let error = app.descendants(matching: .any)["match.comments.postError"]
        assertExists(error)
        XCTAssertEqual(
            error.label,
            "That comment doesn’t meet the community standards. Edit it and try again."
        )
        XCTAssertEqual(input.value as? String, "Rejected draft")
    }

    @MainActor
    func testReportsACommentAndShowsConfirmation() throws {
        let app = launchPreviewApp(scenario: "reporting")

        openComments(in: app)
        let scrollView = app.scrollViews["match.comments.scroll"]
        let actions = app.buttons["match.comments.actions.comment-preview-1"]
        scrollUntilHittable(actions, in: scrollView)
        actions.tap()

        let report = app.buttons["Report Comment"]
        assertExists(report)
        report.tap()

        assertExists(app.navigationBars["Report Comment"])
        let submit = app.buttons["comment.report.submit"]
        assertExists(submit)
        submit.tap()

        let confirmation =
            app.descendants(matching: .any)["match.comments.reportSuccess"]
        assertExists(confirmation)
        XCTAssertEqual(
            confirmation.label,
            "Report received. The tournament operator will review it."
        )
    }

    @MainActor
    func testBlocksACommentAuthorAndRefreshesTheVisibleFeed() throws {
        let app = launchPreviewApp(scenario: "blocking")

        openComments(in: app)
        let scrollView = app.scrollViews["match.comments.scroll"]
        let commentBody =
            app.staticTexts["Alpha Table is one cup away from closing this out."]
        let actions = app.buttons["match.comments.actions.comment-preview-1"]
        scrollUntilHittable(actions, in: scrollView)
        assertExists(commentBody)
        actions.tap()

        let block = app.buttons["Block User"]
        assertExists(block)
        block.tap()

        let confirm = app.buttons["match.comments.block.confirm"]
        assertExists(confirm)
        confirm.tap()

        assertExists(
            app.descendants(matching: .any)["match.comments.blockSuccess"]
        )
        assertDisappears(commentBody)
    }

    @MainActor
    func testUnblocksAnAccountFromAccountSafetySettings() throws {
        let app = launchPreviewApp(scenario: "blocking")

        openAccount(in: app)
        let blockedUsers = app.buttons["account.blocks"]
        assertExists(blockedUsers)
        blockedUsers.tap()

        assertExists(app.navigationBars["Blocked Users"])
        assertExists(app.staticTexts["Blocked Player"])
        let unblock =
            app.buttons["account.blocks.unblock.preview-blocked-user"]
        assertExists(unblock)
        unblock.tap()

        assertExists(app.descendants(matching: .any)["account.blocks.empty"])
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
    private func openLiveMatch(in app: XCUIApplication) {
        let tournament = app.buttons["home.tournamentCard"]
        assertExists(tournament)
        tournament.tap()

        let matches = app.buttons["tournament.section.matches"]
        assertExists(matches)
        matches.tap()

        let liveMatch = app.buttons["tournament.match.match-2026-001"]
        assertExists(liveMatch)
        liveMatch.tap()
        assertExists(app.descendants(matching: .any)["match.detail"])
    }

    @MainActor
    private func openComments(in app: XCUIApplication) {
        openLiveMatch(in: app)
        let chat = app.buttons["match.panel.chat"]
        assertExists(chat)
        chat.tap()
        assertExists(app.scrollViews["match.comments.scroll"])
    }

    @MainActor
    private func assertPolicyLinksExist(in app: XCUIApplication) {
        assertExists(
            app.descendants(matching: .any)["account.policy.privacy"]
        )
        assertExists(
            app.descendants(matching: .any)["account.policy.support"]
        )
        assertExists(
            app.descendants(matching: .any)["account.policy.community"]
        )
    }

    @MainActor
    private func scrollUntilHittable(
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

    @MainActor
    private func assertDisappears(
        _ element: XCUIElement,
        timeout: TimeInterval = 5,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let predicate = NSPredicate(format: "exists == false")
        let expectation = XCTNSPredicateExpectation(
            predicate: predicate,
            object: element
        )
        let result = XCTWaiter.wait(
            for: [expectation],
            timeout: timeout
        )
        XCTAssertEqual(
            result,
            .completed,
            "Expected \(element) to disappear",
            file: file,
            line: line
        )
    }
}
