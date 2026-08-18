//
//  HomeNavigationUITests.swift
//  Ruski ReportUITests
//
//  Qualifies score-feed navigation, content extremes, empty/error states, and
//  accessibility behavior independently from account and community workflows.
//

import XCTest

final class HomeNavigationUITests: PreviewAppUITestCase {
    @MainActor
    func testNavigatesFromHomeToLiveMatch() throws {
        let app = launchPreviewApp()
        assertExists(app.staticTexts["home.title"])
        app.buttons["home.tournamentCard"].tap()
        assertExists(app.descendants(matching: .any)["tournament.header"])
        app.buttons["tournament.section.matches"].tap()
        app.buttons["tournament.match.match-2026-001"].tap()
        assertExists(app.descendants(matching: .any)["match.scoreHeader"])
    }

    @MainActor
    func testOpensLiveGameFromHomeScoreFeed() throws {
        let app = launchPreviewApp()
        let liveMatch = app.buttons["home.match.match-2026-001"]
        assertExists(liveMatch)
        liveMatch.tap()
        assertExists(app.descendants(matching: .any)["match.overview"])
    }

    @MainActor
    func testSwitchesBetweenMatchPanels() throws {
        let app = launchPreviewApp()
        openLiveMatch(in: app)
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
        assertExists(app.buttons["match.panel.scorecard"])
    }

    @MainActor
    func testAccessibilityDynamicTypeKeepsNavigationReachable() throws {
        let app = launchPreviewApp(
            scenario: "longContent",
            additionalArguments: [
                "-UIPreferredContentSizeCategoryName",
                "UICTContentSizeCategoryAccessibilityXXXL"
            ]
        )
        assertExists(app.buttons["home.tournamentCard"])
        app.buttons["home.match.match-2026-001"].tap()
        assertExists(app.descendants(matching: .any)["match.scoreHeader"])
        assertExists(app.buttons["match.panel.scorecard"])
    }

    @MainActor
    func testCoreControlsExposeAccessibleLabels() throws {
        let app = launchPreviewApp()
        assertHasAccessibleLabel(app.buttons["account.toolbar"])
        assertHasAccessibleLabel(app.buttons["home.tournamentCard"])
        assertHasAccessibleLabel(app.buttons["home.match.match-2026-001"])
        app.buttons["home.match.match-2026-001"].tap()
        assertHasAccessibleLabel(app.buttons["match.panel.overview"])
        assertHasAccessibleLabel(app.buttons["match.panel.chat"])
    }

    @MainActor
    func testShowsEmptyTournamentSections() throws {
        let app = launchPreviewApp(scenario: "empty")
        app.buttons["home.tournamentCard"].tap()
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
}
