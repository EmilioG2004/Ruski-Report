//
//  PreviewGameRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class PreviewGameRepository: GameRepository {
    func games() async throws -> [GameDefinition] {
        [PreviewData.gameDefinition]
    }
}
