//
//  TournamentRepository.swift
//  Ruski Report
//

import Foundation

nonisolated protocol TournamentRepository {
    func activeTournament() async throws -> TournamentPreview
    func tournament(id: TournamentPreview.ID) async throws -> TournamentDetail
    func matches(tournamentId: TournamentPreview.ID) async throws -> [MatchPreview]

    func activeTournaments() async throws -> [PublicTournamentSummary]
    func tournament(
        id: PublicTournamentSummary.ID,
        projectionVersion: Int64
    ) async throws -> PublicTournamentDetail
    func matches(
        tournamentId: PublicTournamentSummary.ID,
        projectionVersion: Int64
    ) async throws -> [PublicMatchSummary]
}

extension TournamentRepository {
    func activeTournaments() async throws -> [PublicTournamentSummary] {
        throw AppError.unsupported("Canonical tournament discovery is unavailable.")
    }

    func tournament(
        id: PublicTournamentSummary.ID,
        projectionVersion: Int64
    ) async throws -> PublicTournamentDetail {
        throw AppError.unsupported("Canonical tournament detail is unavailable.")
    }

    func matches(
        tournamentId: PublicTournamentSummary.ID,
        projectionVersion: Int64
    ) async throws -> [PublicMatchSummary] {
        throw AppError.unsupported("Canonical tournament matches are unavailable.")
    }
}
