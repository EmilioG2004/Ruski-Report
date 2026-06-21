//
//  GameRepository.swift
//  Ruski Report
//

import Foundation

nonisolated protocol GameRepository {
    func games() async throws -> [GameDefinition]
}
