//
//  PreviewCommentRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class PreviewCommentRepository: CommentRepository {
    func comments(matchId: MatchPreview.ID) async throws -> [MatchComment] {
        []
    }

    func postComment(matchId: MatchPreview.ID, body: String) async throws -> MatchComment {
        throw AppError.unsupported("Preview comments are read-only.")
    }
}
