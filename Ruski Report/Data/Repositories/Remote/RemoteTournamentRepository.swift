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

    func activeTournaments() async throws -> [PublicTournamentSummary] {
        let envelope: PublicTournamentDiscoveryEnvelopeDTO = try await apiClient.get(
            "v2/tournaments"
        )
        return try PublicTournamentMapper.activeTournaments(from: envelope)
    }

    func historicalTournaments() async throws -> [PublicTournamentSummary] {
        let envelope: PublicTournamentDiscoveryEnvelopeDTO = try await apiClient.get(
            "v2/tournaments/history"
        )
        return try PublicTournamentMapper.historicalTournaments(from: envelope)
    }

    func tournament(
        id: PublicTournamentSummary.ID,
        projectionVersion: Int64
    ) async throws -> PublicTournamentDetail {
        try validateProjectionVersion(projectionVersion)
        let path = "v2/tournaments/\(encodedPathComponent(id))" +
            "?projectionVersion=\(projectionVersion)"
        let envelope: PublicTournamentDetailEnvelopeDTO = try await apiClient.get(path)
        return try PublicTournamentMapper.detail(
            from: envelope,
            expectedTournamentId: id,
            expectedVersion: projectionVersion
        )
    }

    func matches(
        tournamentId: PublicTournamentSummary.ID,
        projectionVersion: Int64
    ) async throws -> [PublicMatchSummary] {
        try validateProjectionVersion(projectionVersion)
        let path = "v2/tournaments/\(encodedPathComponent(tournamentId))/matches" +
            "?projectionVersion=\(projectionVersion)"
        let envelope: PublicMatchListEnvelopeDTO = try await apiClient.get(path)
        return try PublicMatchMapper.matches(
            from: envelope,
            expectedTournamentId: tournamentId,
            expectedVersion: projectionVersion
        )
    }

    private func encodedPathComponent(_ value: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(
            CharacterSet(charactersIn: "-._~")
        )
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    private func validateProjectionVersion(_ value: Int64) throws {
        guard value >= 1, value <= 9_007_199_254_740_991 else {
            throw PublicContractValidationError.invalidValue(
                field: "projectionVersion",
                value: String(value)
            )
        }
    }
}
