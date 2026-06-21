//
//  MatchRepository.swift
//  Ruski Report
//

import Foundation

nonisolated protocol MatchRepository {
    func match(id: MatchPreview.ID) async throws -> MatchDetail
}
