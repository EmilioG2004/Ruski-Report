//
//  RemoteTournamentRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class RemoteTournamentRepository: TournamentRepository {
    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    func activeTournament() async throws -> TournamentPreview {
        let dto: TournamentSummaryDTO = try await apiClient.get("tournaments/active")
        return TournamentMapper.preview(from: dto)
    }

    func tournament(id: TournamentPreview.ID) async throws -> TournamentDetail {
        let dto: TournamentDTO = try await apiClient.get("tournaments/\(id)")
        return TournamentMapper.detail(from: dto)
    }

    func matches(tournamentId: TournamentPreview.ID) async throws -> [MatchPreview] {
        let dtos: [MatchSummaryDTO] = try await apiClient.get(
            "tournaments/\(tournamentId)/matches"
        )
        return dtos.map(MatchMapper.preview)
    }
}
