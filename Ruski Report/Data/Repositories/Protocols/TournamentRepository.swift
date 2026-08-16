//
//  TournamentRepository.swift
//  Ruski Report
//

import Foundation

nonisolated protocol TournamentRepository {
    func activeTournament() async throws -> TournamentPreview
    func tournament(id: TournamentPreview.ID) async throws -> TournamentDetail
    func matches(tournamentId: TournamentPreview.ID) async throws -> [MatchPreview]
}
