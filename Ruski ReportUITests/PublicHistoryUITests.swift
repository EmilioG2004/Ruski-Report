//
//  PublicHistoryUITests.swift
//  Ruski ReportUITests
//

import XCTest

final class PublicHistoryUITests: PreviewAppUITestCase {
    @MainActor
    func testCompletedTournamentOpensPinnedHistoricalMatch() throws {
        let app = launchPreviewApp(scenario: "public-zero")
        app.buttons["history.toolbar"].tap()

        let completed = app.buttons[
            "history.tournament.legacy-championship-2026"
        ]
        assertExists(completed)
        completed.tap()

        let match = app.buttons[
            "tournament.public.match.legacy-championship-2026-public-final-complete"
        ]
        scrollUntilHittable(match, in: app.scrollViews.firstMatch, attempts: 12)
        match.tap()

        assertExists(app.descendants(matching: .any)["match.public.detail"])
        XCTAssertTrue(app.staticTexts["Projection v12"].exists)
    }

    @MainActor
    func testCompletedAndArchivedTournamentsRemainDiscoverableAndPinned() throws {
        let app = launchPreviewApp(scenario: "public-zero")
        let history = app.buttons["history.toolbar"]
        assertExists(history)
        history.tap()

        let scroll = app.scrollViews.firstMatch
        let completed = app.buttons[
            "history.tournament.legacy-championship-2026"
        ]
        let archived = app.buttons[
            "history.tournament.archive-invitational-2025"
        ]
        assertExists(completed)
        scrollUntilExists(archived, in: scroll, attempts: 8)
        XCTAssertTrue(completed.label.contains("2026"))
        XCTAssertTrue(archived.label.contains("Archived"))

        scrollUntilHittable(archived, in: scroll, attempts: 8)
        archived.tap()
        assertExists(
            app.descendants(matching: .any)["tournament.public.detail"]
        )
        let projection = app.descendants(matching: .any)[
            "tournament.public.projection"
        ]
        assertExists(projection)
        XCTAssertTrue(projection.label.contains("4"))
    }
}
