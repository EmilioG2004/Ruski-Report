//
//  StubCommentReportingRepository.swift
//  Ruski ReportTests
//

@testable import Ruski_Report

struct StubCommentReportRequest: Equatable {
    let commentId: MatchComment.ID
    let reason: CommentReportReason
    let context: String?
}

final class StubCommentReportingRepository: CommentReportingRepository {
    private let result: Result<CommentReportReceipt, Error>
    private(set) var requests: [StubCommentReportRequest] = []

    init(
        result: Result<CommentReportReceipt, Error> = .success(
            CommentReportReceipt(
                id: "report-1",
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
        requests.append(
            StubCommentReportRequest(
                commentId: commentId,
                reason: reason,
                context: context
            )
        )
        return try result.get()
    }
}
