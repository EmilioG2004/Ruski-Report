//
//  RepositoryTests.swift
//  Ruski ReportTests
//

import Foundation
import Testing
@testable import Ruski_Report

struct RepositoryTests {
    @Test func tournamentRepositoryLoadsActiveTournamentPath() async throws {
        let apiClient = RecordingAPIClient()
        apiClient.responses["tournaments/active"] = tournamentSummaryDTO()
        let repository = RemoteTournamentRepository(apiClient: apiClient)

        let tournament = try await repository.activeTournament()

        #expect(apiClient.requestedPaths == ["tournaments/active"])
        #expect(tournament.id == "tournament-2026")
        #expect(tournament.status == .active)
    }

    @Test func tournamentRepositoryLoadsMatchesPath() async throws {
        let apiClient = RecordingAPIClient()
        apiClient.responses["tournaments/tournament-2026/matches"] = [
            matchSummaryDTO()
        ]
        let repository = RemoteTournamentRepository(apiClient: apiClient)

        let matches = try await repository.matches(tournamentId: "tournament-2026")

        #expect(apiClient.requestedPaths == ["tournaments/tournament-2026/matches"])
        #expect(matches.map(\.id) == ["match-1"])
    }

    @Test func matchRepositoryLoadsMatchDetailPath() async throws {
        let apiClient = RecordingAPIClient()
        apiClient.responses["matches/match-1"] = matchDetailDTO()
        let repository = RemoteMatchRepository(apiClient: apiClient)

        let match = try await repository.match(id: "match-1")

        #expect(apiClient.requestedPaths == ["matches/match-1"])
        #expect(match.id == "match-1")
    }

    @Test func gameRepositoryMapsGameDefinitions() async throws {
        let apiClient = RecordingAPIClient()
        apiClient.responses["games"] = [gameDefinitionDTO()]
        let repository = RemoteGameRepository(apiClient: apiClient)

        let games = try await repository.games()

        #expect(apiClient.requestedPaths == ["games"])
        #expect(games.first?.gameType == "ruski")
        #expect(games.first?.displayName == "Ruski")
    }
}
