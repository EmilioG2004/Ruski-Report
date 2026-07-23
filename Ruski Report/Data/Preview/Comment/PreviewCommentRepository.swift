//
//  PreviewCommentRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class PreviewCommentRepository: CommentRepository {
    private let previewComments: [MatchComment]
    private let postError: Error

    init(
        previewComments: [MatchComment] = PreviewData.matchComments,
        postError: Error = AppError.unsupported(
            "Preview comments are read-only."
        )
    ) {
        self.previewComments = previewComments
        self.postError = postError
    }

    func comments(matchId: MatchPreview.ID) async throws -> [MatchComment] {
        previewComments.filter { $0.matchId == matchId }
    }

    func postComment(matchId: MatchPreview.ID, body: String) async throws -> MatchComment {
        throw postError
    }
}
