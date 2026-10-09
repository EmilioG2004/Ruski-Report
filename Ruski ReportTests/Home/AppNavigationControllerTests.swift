//
//  AppNavigationControllerTests.swift
//  Ruski ReportTests
//

import SwiftUI
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
        #expect(tournament.discoveryScope == .active)
        #expect(match.matchId == "match-1")
        #expect(match.tournamentId == "tournament-1")
        #expect(match.projectionVersion == nil)
        #expect(match.discoveryScope == .active)
        #expect(AppRoute.canonicalTournament(tournament) != .canonicalMatch(match))
    }

    @Test func historyRoutesRetainDiscoveryScopeWithoutCachingDisplayNames() {
        let tournament = PublicTournamentRouteContext(
            tournamentId: "completed-2026",
            projectionVersion: 12,
            discoveryScope: .history
        )
        let match = PublicMatchRouteContext(
            matchId: "championship-2026",
            tournamentId: "completed-2026",
            projectionVersion: 12,
            discoveryScope: .history
        )

        #expect(tournament.discoveryScope == .history)
        #expect(match.discoveryScope == .history)
    }

    @Test func canonicalNavigationPinsSummaryProjectionVersions() {
        let tournament = controllerTournamentSummary(version: 12)
        let match = controllerMatchDetail(version: 12).summary
        let navigation = AppNavigationController()

        navigation.showTournament(tournament)
        navigation.showMatch(match)
        navigation.showTournamentHistory()

        #expect(navigation.path.count == 3)
    }
}
