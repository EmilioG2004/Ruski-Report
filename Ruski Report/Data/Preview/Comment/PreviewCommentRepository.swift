//
//  PreviewCommentRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class PreviewCommentRepository: CommentRepository {
    private let previewComments: [MatchComment]

    init(previewComments: [MatchComment] = PreviewData.matchComments) {
        self.previewComments = previewComments
    }

    func comments(matchId: MatchPreview.ID) async throws -> [MatchComment] {
        previewComments.filter { $0.matchId == matchId }
    }

    func postComment(matchId: MatchPreview.ID, body: String) async throws -> MatchComment {
        throw AppError.unsupported("Preview comments are read-only.")
    }
}
