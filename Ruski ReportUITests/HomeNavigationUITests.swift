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
        openLiveMatch(in: app)
        assertExists(app.descendants(matching: .any)["match.scoreHeader"])
    }

    @MainActor
    func testOpensLiveGameFromHomeScoreFeed() throws {
        let app = launchPreviewApp()
        openHomeMatch(in: app)
        assertExists(app.descendants(matching: .any)["match.overview"])
    }

    @MainActor
    func testSwitchesBetweenMatchPanels() throws {
        let app = launchPreviewApp()
        openLiveMatch(in: app)
        selectMatchPanel("match.panel.plays", in: app)
        assertExists(app.descendants(matching: .any)["match.events"])
        selectMatchPanel("match.panel.scorecard", in: app)
        assertExists(app.descendants(matching: .any)["match.scorecard"])
        selectMatchPanel("match.panel.chat", in: app)
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
        openHomeMatch(in: app)
        selectMatchPanel("match.panel.scorecard", in: app)
        assertExists(app.descendants(matching: .any)["match.scorecard"])
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
        openHomeMatch(in: app)
        assertExists(app.descendants(matching: .any)["match.scoreHeader"])
        selectMatchPanel("match.panel.scorecard", in: app)
        assertExists(app.descendants(matching: .any)["match.scorecard"])
    }

    @MainActor
    func testCoreControlsExposeAccessibleLabels() throws {
        let app = launchPreviewApp()
        assertHasAccessibleLabel(app.buttons["account.toolbar"])
        assertHasAccessibleLabel(app.buttons["home.tournamentCard"])
        assertHasAccessibleLabel(app.buttons["home.match.match-2026-001"])
        openHomeMatch(in: app)
        assertHasAccessibleLabel(app.buttons["match.panel.overview"])
        selectMatchPanel("match.panel.chat", in: app)
        assertHasAccessibleLabel(app.buttons["match.comments.signIn"])
    }

    @MainActor
    func testShowsEmptyTournamentSections() throws {
        let app = launchPreviewApp(scenario: "empty")
        let tournament = app.buttons["home.tournamentCard"]
        assertExists(tournament)
        tournament.tap()
        let pods = app.buttons["tournament.section.pods"]
        assertExists(pods)
        pods.tap()
        assertExists(app.staticTexts["Pods are not available yet"])
        let matches = app.buttons["tournament.section.matches"]
        assertExists(matches)
        matches.tap()
        assertExists(app.staticTexts["Games are not available yet"])
    }

    @MainActor
    func testShowsUnavailableTournamentState() throws {
        let app = launchPreviewApp(scenario: "unavailable")
        assertExists(app.staticTexts["Tournament unavailable"])
        assertExists(app.buttons["Retry"])
    }
}
