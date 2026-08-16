//
//  RemoteGameRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class RemoteGameRepository: GameRepository {
    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    func games() async throws -> [GameDefinition] {
        let dtos: [GameDefinitionDTO] = try await apiClient.get("games")
        return dtos.map(GameDefinitionMapper.map)
    }
}
