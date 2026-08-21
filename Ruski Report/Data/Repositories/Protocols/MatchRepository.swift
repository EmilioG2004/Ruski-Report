//
//  MatchRepository.swift
//  Ruski Report
//

import Foundation

nonisolated protocol MatchRepository {
    func match(id: MatchPreview.ID) async throws -> MatchDetail

    func match(
        id: PublicMatchSummary.ID,
        tournamentId: PublicTournamentSummary.ID,
        projectionVersion: Int64
    ) async throws -> PublicMatchDetail
}

extension MatchRepository {
    func match(
        id: PublicMatchSummary.ID,
        tournamentId: PublicTournamentSummary.ID,
        projectionVersion: Int64
    ) async throws -> PublicMatchDetail {
        throw AppError.unsupported("Canonical match detail is unavailable.")
    }
}
