//
//  PreviewCommentReportingRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class PreviewCommentReportingRepository: CommentReportingRepository {
    private let result: Result<CommentReportReceipt, Error>

    init(
        result: Result<CommentReportReceipt, Error> = .success(
            CommentReportReceipt(
                id: "report-preview",
                status: "open",
                submittedAt: "2026-07-23T12:00:00.000Z",
                alreadyReported: false
            )
        )
    ) {
        self.result = result
    }

    func submitReport(
        commentId: MatchComment.ID,
        reason: CommentReportReason,
        context: String?
    ) async throws -> CommentReportReceipt {
        try result.get()
    }
}
