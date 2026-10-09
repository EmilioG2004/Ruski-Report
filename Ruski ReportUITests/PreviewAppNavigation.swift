//
//  PreviewAppNavigation.swift
//  Ruski ReportUITests
//
//  Encapsulates repeatable preview navigation. The helpers wait for each route
//  boundary and scroll extensible rails before interacting with their options.
//

import XCTest

extension PreviewAppUITestCase {
    @MainActor
    func openAccount(in app: XCUIApplication) {
        let accountButton = app.buttons["account.toolbar"]
        assertExists(accountButton)
        accountButton.tap()
        assertExists(app.navigationBars["Account"])
    }

    @MainActor
    func openLiveMatch(in app: XCUIApplication) {
        let tournament = app.buttons["home.tournamentCard"]
        assertExists(tournament)
        tournament.tap()
        assertExists(app.descendants(matching: .any)["tournament.header"])

        let matches = app.buttons["tournament.section.matches"]
        assertExists(matches)
        matches.tap()

        let liveMatch = app.buttons["tournament.match.match-2026-001"]
        assertExists(liveMatch)
        liveMatch.tap()
        assertExists(app.descendants(matching: .any)["match.detail"])
    }

    @MainActor
    func openHomeMatch(in app: XCUIApplication) {
        let homeScroll = app.scrollViews.firstMatch
        assertExists(homeScroll)

        let liveMatch = app.buttons["home.match.match-2026-001"]
        scrollUntilHittable(liveMatch, in: homeScroll, attempts: 10)
        liveMatch.tap()
        assertExists(app.descendants(matching: .any)["match.detail"])
    }

    @MainActor
    func openComments(in app: XCUIApplication) {
        openLiveMatch(in: app)
        selectMatchPanel("match.panel.chat", in: app)
        assertExists(app.descendants(matching: .any)["match.comments.scroll"])
    }

    @MainActor
    func selectMatchPanel(
        _ identifier: String,
        in app: XCUIApplication,
        attempts: Int = 4
    ) {
        let picker = app.scrollViews["match.panelPicker"]
        assertExists(picker)

        let panel = app.buttons[identifier]
        for _ in 0..<attempts where !panel.isHittable {
            picker.swipeLeft()
        }
        assertExists(panel)
        XCTAssertTrue(panel.isHittable, "Expected match panel to be hittable")
        panel.tap()
    }
}
