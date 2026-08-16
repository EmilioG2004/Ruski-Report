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
}
