//
//  AccountUITests.swift
//  Ruski ReportUITests
//
//  Qualifies guest/authenticated presentation, policy links, destructive
//  confirmation, and the user's path back to a guest session.
//

import XCTest

final class AccountUITests: PreviewAppUITestCase {
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
        assertExists(
            app.descendants(matching: .any)["account.status.authenticated"]
        )
        assertExists(app.buttons["account.signOut"])
        assertExists(app.buttons["account.delete"])
        assertPolicyLinksExist(in: app)
    }

    @MainActor
    func testCancelsAccountDeletion() throws {
        let app = launchPreviewApp(scenario: "authenticated")
        openAccount(in: app)
        app.buttons["account.delete"].tap()
        let cancelButton = app.buttons
            .matching(identifier: "account.delete.cancel")
            .firstMatch
        assertExists(cancelButton)
        cancelButton.tap()
        assertExists(app.buttons["account.delete"])
    }

    @MainActor
    func testConfirmsAccountDeletionAndReturnsToGuestState() throws {
        let app = launchPreviewApp(scenario: "authenticated")
        openAccount(in: app)
        app.buttons["account.delete"].tap()
        let confirmButton = app.buttons
            .matching(identifier: "account.delete.confirm")
            .firstMatch
        assertExists(confirmButton)
        confirmButton.tap()
        assertExists(app.descendants(matching: .any)["account.status.guest"])
        assertExists(
            app.descendants(matching: .any)["account.deletion.success"]
        )
    }
}
