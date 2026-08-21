//
//  PublicDisplayNavigation.swift
//  Ruski ReportUITests
//

import XCTest

extension PreviewAppUITestCase {
    @MainActor
    func openPublicTournament(in app: XCUIApplication) {
        let tournament = app.buttons[
            "home.public.tournament.summer-classic-2027"
        ]
        let homeScroll = app.scrollViews.firstMatch
        scrollUntilHittable(tournament, in: homeScroll, attempts: 12)
        tournament.tap()
        assertExists(
            app.descendants(matching: .any)["tournament.public.detail"]
        )
    }

    @MainActor
    func selectPublicTournamentSection(
        _ identifier: String,
        in app: XCUIApplication
    ) {
        let outerScroll = app.scrollViews.firstMatch
        for _ in 0..<12 where !app.buttons[identifier].isHittable {
            outerScroll.swipeDown()
        }

        let picker = app.scrollViews["tournament.sectionPicker"]
        assertExists(picker)
        let button = app.buttons[identifier]
        for _ in 0..<5 where !button.isHittable {
            picker.swipeLeft()
        }
        assertExists(button)
        XCTAssertTrue(button.isHittable)
        button.tap()
    }

    @MainActor
    func scrollUntilExists(
        _ element: XCUIElement,
        in scrollView: XCUIElement,
        attempts: Int = 12
    ) {
        for _ in 0..<attempts where !element.exists {
            scrollView.swipeUp()
        }
        assertExists(element)
    }
}
