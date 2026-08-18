//
//  CommunitySafetyUITests.swift
//  Ruski ReportUITests
//
//  Qualifies safe moderation messaging, report confirmation, blocking, and
//  account-level unblock behavior with deterministic preview repositories.
//

import XCTest

final class CommunitySafetyUITests: PreviewAppUITestCase {
    @MainActor
    func testShowsSafeModerationErrorAndPreservesDraft() throws {
        let app = launchPreviewApp(scenario: "moderationRejected")
        openComments(in: app)
        let scrollView =
            app.descendants(matching: .any)["match.comments.scroll"]
        let input = app.textFields["match.comments.input"]
        scrollUntilHittable(input, in: scrollView)
        input.tap()
        input.typeText("Rejected draft")
        app.buttons["match.comments.post"].tap()

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
        let scrollView =
            app.descendants(matching: .any)["match.comments.scroll"]
        let actions = app.buttons["match.comments.actions.comment-preview-1"]
        scrollUntilHittable(actions, in: scrollView)
        actions.tap()
        app.buttons["Report Comment"].tap()
        assertExists(app.navigationBars["Report Comment"])
        app.buttons["comment.report.submit"].tap()
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
        let scrollView =
            app.descendants(matching: .any)["match.comments.scroll"]
        let commentBody =
            app.staticTexts["Alpha Table is one cup away from closing this out."]
        let actions = app.buttons["match.comments.actions.comment-preview-1"]
        scrollUntilHittable(actions, in: scrollView)
        assertExists(commentBody)
        actions.tap()
        app.buttons["Block User"].tap()
        app.buttons
            .matching(identifier: "match.comments.block.confirm")
            .firstMatch
            .tap()
        assertExists(
            app.descendants(matching: .any)["match.comments.blockSuccess"]
        )
        assertDisappears(commentBody)
    }

    @MainActor
    func testUnblocksAnAccountFromAccountSafetySettings() throws {
        let app = launchPreviewApp(scenario: "blocking")
        openAccount(in: app)
        app.buttons["account.blocks"].tap()
        assertExists(app.navigationBars["Blocked Users"])
        assertExists(app.staticTexts["Blocked Player"])
        app.buttons["account.blocks.unblock.preview-blocked-user"].tap()
        assertExists(app.descendants(matching: .any)["account.blocks.empty"])
    }
}
