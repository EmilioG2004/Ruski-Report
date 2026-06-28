//
//  MatchCommentsController.swift
//  Ruski Report
//

import Combine
import Foundation

@MainActor
final class MatchCommentsController: ObservableObject {
    @Published private(set) var state: MatchCommentsViewState = .loading

    private let matchId: MatchPreview.ID
    private let comments: any CommentRepository
    private let session: any SessionRepository
    private let logger: any AppLogger
    private let authorizationPolicy: CommentAuthorizationPolicy
    private let configuration: CommentPostingConfiguration

    init(
        matchId: MatchPreview.ID,
        comments: any CommentRepository,
        session: any SessionRepository,
        logger: any AppLogger,
        authorizationPolicy: CommentAuthorizationPolicy = CommentAuthorizationPolicy(),
        configuration: CommentPostingConfiguration = .default
    ) {
        self.matchId = matchId
        self.comments = comments
        self.session = session
        self.logger = logger
        self.authorizationPolicy = authorizationPolicy
        self.configuration = configuration
    }

    func loadComments() async {
        state = .loading

        do {
            let currentSession = await session.currentSession()
            let loadedComments = try await comments.comments(matchId: matchId)
            state = .loaded(
                MatchCommentsContent(
                    comments: loadedComments,
                    postingAuthorization: authorizationPolicy.postingAuthorization(
                        for: currentSession
                    ),
                    isPosting: false,
                    postErrorMessage: nil
                )
            )
        } catch {
            logger.log(
                .warning,
                "Unable to load match comments",
                metadata: [
                    "error": String(describing: error),
                    "matchId": matchId
                ]
            )
            state = .failed(
                message: AppErrorMessageFormatter.message(
                    from: error,
                    fallback: "Unable to load match comments."
                )
            )
        }
    }

    @discardableResult
    func postComment(body: String) async -> Bool {
        guard case .loaded(let content) = state else {
            return false
        }

        guard content.postingAuthorization.allowsPosting else {
            state = .loaded(
                content.updated(
                    postErrorMessage: signInMessage(from: content.postingAuthorization)
                )
            )
            return false
        }

        let validatedBody = configuration.validatedBody(body)
        guard case .success(let trimmedBody) = validatedBody else {
            if case .failure(.invalid(let message)) = validatedBody {
                state = .loaded(content.updated(postErrorMessage: message))
            }
            return false
        }

        state = .loaded(content.posting(true))

        do {
            let postedComment = try await comments.postComment(
                matchId: matchId,
                body: trimmedBody
            )
            state = .loaded(
                content.updated(comments: content.comments + [postedComment])
            )
            return true
        } catch {
            logger.log(
                .warning,
                "Unable to post match comment",
                metadata: [
                    "error": String(describing: error),
                    "matchId": matchId
                ]
            )
            state = .loaded(
                content.updated(
                    postErrorMessage: AppErrorMessageFormatter.message(
                        from: error,
                        fallback: "Unable to post comment."
                    )
                )
            )
            return false
        }
    }

    private func signInMessage(
        from authorization: CommentPostingAuthorization
    ) -> String {
        switch authorization {
        case .allowed:
            "Unable to post comment."
        case .requiresSignIn(let message):
            message
        }
    }
}
