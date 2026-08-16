//
//  PreviewCommentRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class PreviewCommentRepository: CommentRepository {
    private let previewComments: [MatchComment]
    private let postError: Error
    private let blockingState: PreviewUserBlockingState?

    init(
        previewComments: [MatchComment] = PreviewData.matchComments,
        blockingState: PreviewUserBlockingState? = nil,
        postError: Error = AppError.unsupported(
            "Preview comments are read-only."
        )
    ) {
        self.previewComments = previewComments
        self.blockingState = blockingState
        self.postError = postError
    }

    func comments(matchId: MatchPreview.ID) async throws -> [MatchComment] {
        let blockedUserIds = await blockingState?.blockedUserIds() ?? []
        return previewComments.filter {
            $0.matchId == matchId &&
                ($0.authorUserId.map(blockedUserIds.contains) != true)
        }
    }

    func postComment(matchId: MatchPreview.ID, body: String) async throws -> MatchComment {
        throw postError
    }
}
