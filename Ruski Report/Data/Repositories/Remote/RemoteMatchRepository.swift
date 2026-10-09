//
//  RemoteMatchRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class RemoteMatchRepository: MatchRepository {
    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    func match(id: MatchPreview.ID) async throws -> MatchDetail {
        let dto: MatchDetailDTO = try await apiClient.get("matches/\(id)")
        return MatchMapper.detail(dto)
    }

    func match(
        id: PublicMatchSummary.ID,
        tournamentId: PublicTournamentSummary.ID,
        projectionVersion: Int64
    ) async throws -> PublicMatchDetail {
        guard projectionVersion >= 1,
              projectionVersion <= 9_007_199_254_740_991 else {
            throw PublicContractValidationError.invalidValue(
                field: "projectionVersion",
                value: String(projectionVersion)
            )
        }
        let path = "v2/matches/\(encodedPathComponent(id))" +
            "?projectionVersion=\(projectionVersion)"
        let envelope: PublicMatchDetailEnvelopeDTO = try await apiClient.get(path)
        return try PublicMatchMapper.detail(
            from: envelope,
            expectedTournamentId: tournamentId,
            expectedMatchId: id,
            expectedVersion: projectionVersion
        )
    }

    private func encodedPathComponent(_ value: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(
            CharacterSet(charactersIn: "-._~")
        )
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}
