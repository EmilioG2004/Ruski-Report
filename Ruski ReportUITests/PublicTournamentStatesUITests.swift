//
//  PublicTournamentStatesUITests.swift
//  Ruski ReportUITests
//
//  Qualifies standings and bracket display states from one immutable public
//  tournament projection.
//

import XCTest

final class PublicTournamentStatesUITests: PreviewAppUITestCase {
    @MainActor
    func testStandingsShowZeroProvisionalFinalAndResolvedTieStates() throws {
        let app = launchPreviewApp(scenario: "public-states")
        openPublicTournament(in: app)
        selectPublicTournamentSection("tournament.section.pods", in: app)
        let scroll = app.scrollViews.firstMatch

        let states = ["zero_game", "active", "finalized", "unresolved_tie"]
        for state in states {
            scrollUntilExists(
                app.descendants(matching: .any)[
                    "tournament.public.pod.state.\(state)"
                ],
                in: scroll,
                attempts: 6
            )
        }

        scrollUntilExists(
            app.descendants(matching: .any)[
                "tournament.public.standing.team-green.adminResolved"
            ],
            in: scroll,
            attempts: 6
        )
    }

    @MainActor
    func testBracketShowsEveryProgressionAndPlaceholderState() throws {
        let app = launchPreviewApp(scenario: "public-states")
        openPublicTournament(in: app)
        selectPublicTournamentSection("tournament.section.bracket", in: app)
        let outerScroll = app.scrollViews.firstMatch

        for state in ["automatic", "blocked", "ready", "live"] {
            scrollUntilExists(
                app.descendants(matching: .any)[
                    "tournament.public.bracket.state.\(state)"
                ],
                in: outerScroll,
                attempts: 8
            )
        }

        assertExists(
            app.descendants(matching: .any)[
                "tournament.public.bracket.slot.bye"
            ]
        )
        assertExists(
            app.descendants(matching: .any)[
                "tournament.public.bracket.slot.tbd"
            ]
        )

        let bracket = app.scrollViews["tournament.public.bracket"]
        assertExists(bracket)
        bracket.swipeLeft()

        assertExists(
            app.descendants(matching: .any)[
                "tournament.public.bracket.state.waiting"
            ]
        )
        assertExists(
            app.descendants(matching: .any)[
                "tournament.public.bracket.state.completed"
            ]
        )
        assertExists(
            app.descendants(matching: .any)[
                "tournament.public.bracket.slot.waiting"
            ]
        )
    }
}
