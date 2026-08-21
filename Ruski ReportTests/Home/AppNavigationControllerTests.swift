//
//  AppNavigationControllerTests.swift
//  Ruski ReportTests
//

import Testing
@testable import Ruski_Report

@MainActor
struct AppNavigationControllerTests {
    @Test func canonicalRoutesCarryOnlyStableIdentityAndOptionalProjection() {
        let tournament = PublicTournamentRouteContext(
            tournamentId: "tournament-1",
            projectionVersion: 12
        )
        let match = PublicMatchRouteContext(
            matchId: "match-1",
            tournamentId: "tournament-1",
            projectionVersion: nil
        )

        #expect(tournament.tournamentId == "tournament-1")
        #expect(tournament.projectionVersion == 12)
        #expect(match.matchId == "match-1")
        #expect(match.tournamentId == "tournament-1")
        #expect(match.projectionVersion == nil)
        #expect(AppRoute.canonicalTournament(tournament) != .canonicalMatch(match))
    }

    @Test func canonicalNavigationPinsSummaryProjectionVersions() {
        let tournament = controllerTournamentSummary(version: 12)
        let match = controllerMatchDetail(version: 12).summary
        let navigation = AppNavigationController()

        navigation.showTournament(tournament)
        navigation.showMatch(match)

        #expect(navigation.path.count == 2)
    }
}
