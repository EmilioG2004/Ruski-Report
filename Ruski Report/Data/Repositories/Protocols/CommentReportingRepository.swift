//
//  CommentReportingRepository.swift
//  Ruski Report
//

import Foundation

nonisolated protocol CommentReportingRepository {
    func submitReport(
        commentId: MatchComment.ID,
        reason: CommentReportReason,
        context: String?
    ) async throws -> CommentReportReceipt
}
