//
//  CommentReportingController.swift
//  Ruski Report
//

import Combine
import Foundation

@MainActor
final class CommentReportingController: ObservableObject {
    @Published private(set) var state: CommentReportingViewState = .idle

    private let reports: any CommentReportingRepository
    private let session: any SessionRepository
    private let logger: any AppLogger
    private let authorizationPolicy: CommentReportingAuthorizationPolicy
    private let configuration: CommentReportingConfiguration

    init(
        reports: any CommentReportingRepository,
        session: any SessionRepository,
        logger: any AppLogger,
        authorizationPolicy: CommentReportingAuthorizationPolicy =
            CommentReportingAuthorizationPolicy(),
        configuration: CommentReportingConfiguration = .default
    ) {
        self.reports = reports
        self.session = session
        self.logger = logger
        self.authorizationPolicy = authorizationPolicy
        self.configuration = configuration
    }

    func reset() {
        state = .idle
    }

    func submit(
        commentId: MatchComment.ID,
        reason: CommentReportReason,
        context: String
    ) async -> CommentReportSubmissionOutcome {
        let currentSession = await session.currentSession()
        let authorization = authorizationPolicy.authorization(for: currentSession)
        guard authorization.allowsReporting else {
            let message = authorization.message
            state = .failed(message: message)
            return .failed
        }

        let validation = configuration.validatedContext(context, reason: reason)
        guard case .success(let validatedContext) = validation else {
            if case .failure(.invalid(let message)) = validation {
                state = .failed(message: message)
            }
            return .failed
        }

        state = .submitting(commentId: commentId)
        do {
            let receipt = try await reports.submitReport(
                commentId: commentId,
                reason: reason,
                context: validatedContext
            )
            let message = receipt.alreadyReported
                ? "You already reported this comment."
                : "Report received. The tournament operator will review it."
            state = .succeeded(message: message)
            return .submitted
        } catch {
            logger.log(
                .warning,
                "Unable to submit comment report",
                metadata: [
                    "error": String(describing: error),
                    "commentId": commentId,
                    "reason": reason.rawValue
                ]
            )
            let unavailable = CommentReportErrorFormatter.isCommentUnavailable(error)
            state = .failed(message: CommentReportErrorFormatter.message(from: error))
            return unavailable ? .commentUnavailable : .failed
        }
    }
}

nonisolated enum CommentReportSubmissionOutcome: Equatable {
    case submitted
    case commentUnavailable
    case failed
}

nonisolated enum CommentReportingViewState: Equatable {
    case idle
    case submitting(commentId: MatchComment.ID)
    case succeeded(message: String)
    case failed(message: String)

    var isSubmitting: Bool {
        if case .submitting = self {
            return true
        }
        return false
    }

    var errorMessage: String? {
        guard case .failed(let message) = self else {
            return nil
        }
        return message
    }

    var successMessage: String? {
        guard case .succeeded(let message) = self else {
            return nil
        }
        return message
    }
}

private extension CommentReportingAuthorization {
    var message: String {
        switch self {
        case .allowed:
            "Unable to submit the report."
        case .requiresSignIn(let message):
            message
        }
    }
}
