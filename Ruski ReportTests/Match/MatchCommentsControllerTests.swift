//
//  MatchCommentsControllerTests.swift
//  Ruski ReportTests
//

import Testing
@testable import Ruski_Report

@MainActor
struct MatchCommentsControllerTests {
    @Test func loadCommentsPublishesMatchScopedCommentsAndAuthorization() async {
        let repository = StubCommentRepository(
            commentsResult: .success([Self.existingComment])
        )
        let controller = MatchCommentsController(
            matchId: "match-1",
            comments: repository,
            session: StubSessionRepository(session: Self.authenticatedSession),
            logger: NoopAppLogger()
        )

        await controller.loadComments()

        #expect(repository.requestedMatchIds == ["match-1"])
        #expect(
            controller.state == .loaded(
                MatchCommentsContent(
                    comments: [Self.existingComment],
                    postingAuthorization: .allowed,
                    isPosting: false,
                    postErrorMessage: nil
                )
            )
        )
    }

    @Test func guestPostShowsSignInMessageWithoutCallingRepository() async {
        let repository = StubCommentRepository(commentsResult: .success([]))
        let controller = MatchCommentsController(
            matchId: "match-1",
            comments: repository,
            session: StubSessionRepository(session: .guest),
            logger: NoopAppLogger()
        )

        await controller.loadComments()
        let posted = await controller.postComment(body: "Great match.")

        #expect(!posted)
        #expect(repository.postRequests.isEmpty)
        #expect(
            controller.state == .loaded(
                MatchCommentsContent(
                    comments: [],
                    postingAuthorization: .requiresSignIn(
                        message: "Sign in to post comments."
                    ),
                    isPosting: false,
                    postErrorMessage: "Sign in to post comments."
                )
            )
        )
    }

    @Test func authenticatedPostTrimsBodyAndAppendsComment() async {
        let repository = StubCommentRepository(
            commentsResult: .success([Self.existingComment]),
            postResult: .success(Self.postedComment)
        )
        let controller = MatchCommentsController(
            matchId: "match-1",
            comments: repository,
            session: StubSessionRepository(session: Self.authenticatedSession),
            logger: NoopAppLogger()
        )

        await controller.loadComments()
        let posted = await controller.postComment(body: "  Clutch finish.  ")

        #expect(posted)
        #expect(
            repository.postRequests == [
                StubCommentPostRequest(matchId: "match-1", body: "Clutch finish.")
            ]
        )
        #expect(
            controller.state == .loaded(
                MatchCommentsContent(
                    comments: [Self.existingComment, Self.postedComment],
                    postingAuthorization: .allowed,
                    isPosting: false,
                    postErrorMessage: nil
                )
            )
        )
    }

    @Test func loadFailurePublishesReadableMessage() async {
        let controller = MatchCommentsController(
            matchId: "match-1",
            comments: StubCommentRepository(
                commentsResult: .failure(
                    AppError.networkUnavailable("Comments are offline.")
                )
            ),
            session: StubSessionRepository(session: Self.authenticatedSession),
            logger: NoopAppLogger()
        )

        await controller.loadComments()

        #expect(controller.state == .failed(message: "Comments are offline."))
    }

    private static let authenticatedSession = UserSession.authenticated(
        UserProfile(
            id: "user-1",
            displayName: "Alex",
            provider: .gameCenter
        )
    )

    private static let existingComment = MatchComment(
        id: "comment-1",
        matchId: "match-1",
        authorDisplayName: "Sam",
        body: "Great start.",
        createdAt: "2026-06-21T00:12:00.000Z"
    )

    private static let postedComment = MatchComment(
        id: "comment-2",
        matchId: "match-1",
        authorDisplayName: "Alex",
        body: "Clutch finish.",
        createdAt: "2026-06-21T00:18:00.000Z"
    )
}
