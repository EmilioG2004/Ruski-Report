//
//  CommentRepository.swift
//  Ruski Report
//

import Foundation

nonisolated protocol CommentRepository {
    func comments(matchId: MatchPreview.ID) async throws -> [MatchComment]
    func postComment(matchId: MatchPreview.ID, body: String) async throws -> MatchComment
}
