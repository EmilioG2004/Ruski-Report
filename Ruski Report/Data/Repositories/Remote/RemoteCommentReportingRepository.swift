//
//  RemoteCommentReportingRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class RemoteCommentReportingRepository: CommentReportingRepository {
    private let apiClient: APIClient
    private let session: any SessionRepository
    private let authorizationPolicy: CommentReportingAuthorizationPolicy

    init(
        apiClient: APIClient,
        session: any SessionRepository,
        authorizationPolicy: CommentReportingAuthorizationPolicy =
            CommentReportingAuthorizationPolicy()
    ) {
        self.apiClient = apiClient
        self.session = session
        self.authorizationPolicy = authorizationPolicy
    }

    func submitReport(
        commentId: MatchComment.ID,
        reason: CommentReportReason,
        context: String?
    ) async throws -> CommentReportReceipt {
        let currentSession = await session.currentSession()
        guard authorizationPolicy.authorization(for: currentSession).allowsReporting else {
            throw AppError.unsupported("Sign in to report comments.")
        }

        let dto: CommentReportReceiptDTO = try await apiClient.post(
            "comments/\(commentId)/reports",
            body: SubmitCommentReportRequestDTO(
                reason: reason.rawValue,
                context: context
            )
        )
        return CommentReportMapper.map(dto)
    }
}
