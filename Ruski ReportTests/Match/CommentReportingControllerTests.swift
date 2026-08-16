//
//  CommentReportingControllerTests.swift
//  Ruski ReportTests
//

import Testing
@testable import Ruski_Report

@MainActor
struct CommentReportingControllerTests {
    @Test func authenticatedReportNormalizesContextAndShowsConfirmation() async {
        let repository = StubCommentReportingRepository()
        let controller = makeController(reports: repository)

        let outcome = await controller.submit(
            commentId: "comment-1",
            reason: .harassment,
            context: "  Repeated insults.  "
        )

        #expect(outcome == .submitted)
        #expect(
            repository.requests == [
                StubCommentReportRequest(
                    commentId: "comment-1",
                    reason: .harassment,
                    context: "Repeated insults."
                )
            ]
        )
        #expect(
            controller.state ==
                .succeeded(
                    message: "Report received. The tournament operator will review it."
                )
        )
    }

    @Test func duplicateReceiptUsesIdempotentConfirmation() async {
        let repository = StubCommentReportingRepository(
            result: .success(
                CommentReportReceipt(
                    id: "report-existing",
                    status: "open",
                    submittedAt: "2026-07-23T12:00:00.000Z",
                    alreadyReported: true
                )
            )
        )
        let controller = makeController(reports: repository)

        let outcome = await controller.submit(
            commentId: "comment-1",
            reason: .spam,
            context: ""
        )

        #expect(outcome == .submitted)
        #expect(
            controller.state ==
                .succeeded(message: "You already reported this comment.")
        )
    }

    @Test func guestCannotCallTheReportingRepository() async {
        let repository = StubCommentReportingRepository()
        let controller = makeController(
            reports: repository,
            session: .guest
        )

        let outcome = await controller.submit(
            commentId: "comment-1",
            reason: .spam,
            context: ""
        )

        #expect(outcome == .failed)
        #expect(repository.requests.isEmpty)
        #expect(
            controller.state ==
                .failed(message: "Sign in to report comments.")
        )
    }

    @Test func unavailableCommentUsesSafeCopyAndSignalsRefresh() async {
        let repository = StubCommentReportingRepository(
            result: .failure(
                AppError.backend(
                    code: "NOT_FOUND",
                    message: "Unsafe internal lookup details.",
                    details: [
                        AppErrorDetail(
                            code: "COMMENT_NOT_AVAILABLE",
                            message: "Private removal metadata.",
                            path: "commentId"
                        )
                    ]
                )
            )
        )
        let controller = makeController(reports: repository)

        let outcome = await controller.submit(
            commentId: "comment-1",
            reason: .harassment,
            context: ""
        )

        #expect(outcome == .commentUnavailable)
        #expect(
            controller.state ==
                .failed(message: "That comment is no longer available.")
        )
    }

    @Test func unknownBackendFailureDoesNotEchoServerDetails() async {
        let repository = StubCommentReportingRepository(
            result: .failure(
                AppError.backend(
                    code: "INTERNAL_ERROR",
                    message: "Private moderation infrastructure detail.",
                    details: []
                )
            )
        )
        let controller = makeController(reports: repository)

        let outcome = await controller.submit(
            commentId: "comment-1",
            reason: .spam,
            context: ""
        )

        #expect(outcome == .failed)
        #expect(
            controller.state ==
                .failed(message: "Unable to submit the report.")
        )
    }

    @Test func localValidationRequiresContextForOther() async {
        let repository = StubCommentReportingRepository()
        let controller = makeController(reports: repository)

        let outcome = await controller.submit(
            commentId: "comment-1",
            reason: .other,
            context: " "
        )

        #expect(outcome == .failed)
        #expect(repository.requests.isEmpty)
        #expect(
            controller.state ==
                .failed(message: "Add context when selecting Other.")
        )
    }

    private func makeController(
        reports: StubCommentReportingRepository,
        session: UserSession = .authenticated(
            UserProfile(id: "user-1", displayName: "Reporter")
        )
    ) -> CommentReportingController {
        CommentReportingController(
            reports: reports,
            session: StubSessionRepository(session: session),
            logger: NoopAppLogger()
        )
    }
}
