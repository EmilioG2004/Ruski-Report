//
//  PublicHomeAndMatchUITests.swift
//  Ruski ReportUITests
//
//  Qualifies canonical discovery, explicit score availability, embedded
//  historical identity, and long accessible content.
//

import XCTest

final class PublicHomeAndMatchUITests: PreviewAppUITestCase {
    @MainActor
    func testZeroActiveTournamentsHasExplicitEmptyState() throws {
        let app = launchPreviewApp(scenario: "public-zero")
        assertExists(app.descendants(matching: .any)["home.public.empty"])
    }

    @MainActor
    func testTwoSameYearTournamentsAreDiscoverable() throws {
        let app = launchPreviewApp(scenario: "public-two")
        let scroll = app.scrollViews.firstMatch
        let summer = app.buttons[
            "home.public.tournament.summer-classic-2027"
        ]
        let fall = app.buttons[
            "home.public.tournament.fall-invitational-2027"
        ]

        assertExists(summer)
        XCTAssertTrue(summer.label.contains("2027"))
        scrollUntilHittable(fall, in: scroll, attempts: 16)
        XCTAssertTrue(fall.label.contains("2027"))
    }

    @MainActor
    func testEveryMatchResolutionKeepsStatusAndScoreAvailabilitySeparate() throws {
        let app = launchPreviewApp(scenario: "public-states")
        openPublicTournament(in: app)
        let scroll = app.scrollViews.firstMatch

        let expected = [
            ("public-live-partial", "in_progress", "partial"),
            ("public-scheduled-unknown", "scheduled", "not_started"),
            ("public-scheduled-known", "scheduled", "not_started"),
            ("public-postponed", "postponed", "not_started"),
            ("public-final-complete", "final", "complete"),
            ("public-final-unrecorded", "final", "unrecorded"),
            ("public-forfeited", "forfeited", "not_applicable"),
            ("public-cancelled", "cancelled", "not_applicable")
        ]

        for (matchID, status, availability) in expected {
            let statusElement = app.descendants(matching: .any)[
                "tournament.public.match.\(matchID).status.\(status)"
            ]
            scrollUntilExists(statusElement, in: scroll, attempts: 5)
            assertExists(
                app.descendants(matching: .any)[
                    "tournament.public.match.\(matchID).availability.\(availability)"
                ]
            )
            if matchID == "public-scheduled-unknown" {
                XCTAssertTrue(
                    app.buttons[
                        "tournament.public.match.public-scheduled-unknown"
                    ].label.contains("Schedule TBD")
                )
            }
        }

        scrollUntilExists(
            app.buttons["tournament.public.match.public-playoff-rematch"],
            in: scroll,
            attempts: 5
        )
    }

    @MainActor
    func testMatchDetailUsesHistoricalProjectionParticipants() throws {
        let app = launchPreviewApp(scenario: "public-states")
        openPublicTournament(in: app)
        let scroll = app.scrollViews.firstMatch
        let match = app.buttons[
            "tournament.public.match.public-final-complete"
        ]
        scrollUntilHittable(match, in: scroll, attempts: 16)
        match.tap()

        assertExists(app.descendants(matching: .any)["match.public.screen"])
        let players = app.descendants(matching: .any)[
            "match.public.participant.team-red.players"
        ]
        assertExists(players)
        XCTAssertTrue(players.label.contains("Alex Original"))
        XCTAssertFalse(players.label.contains("Riley Replacement"))
    }

    @MainActor
    func testLongContentRemainsNavigableAtAccessibilityXXXLInDarkMode() throws {
        let app = launchPreviewApp(
            scenario: "public-long-content",
            additionalArguments: [
                "-UIPreferredContentSizeCategoryName",
                "UICTContentSizeCategoryAccessibilityXXXL",
                "-AppleInterfaceStyle",
                "Dark"
            ]
        )
        let scroll = app.scrollViews.firstMatch
        let tournament = app.buttons[
            "home.public.tournament.summer-classic-2027"
        ]
        scrollUntilHittable(tournament, in: scroll, attempts: 12)
        XCTAssertTrue(
            tournament.label.contains(
                "North Durham Longtable Invitational Championship"
            )
        )

        let match = app.buttons["home.public.match.public-long-match"]
        scrollUntilHittable(match, in: scroll, attempts: 16)
        match.tap()
        assertExists(app.descendants(matching: .any)["match.public.screen"])
    }
}
