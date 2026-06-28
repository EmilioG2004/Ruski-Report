//
//  RemoteCommentRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class RemoteCommentRepository: CommentRepository {
    private let apiClient: APIClient
    private let session: any SessionRepository
    private let authorizationPolicy: CommentAuthorizationPolicy

    init(
        apiClient: APIClient,
        session: any SessionRepository,
        authorizationPolicy: CommentAuthorizationPolicy = CommentAuthorizationPolicy()
    ) {
        self.apiClient = apiClient
        self.session = session
        self.authorizationPolicy = authorizationPolicy
    }

    func comments(matchId: MatchPreview.ID) async throws -> [MatchComment] {
        let dtos: [CommentDTO] = try await apiClient.get("matches/\(matchId)/comments")
        return dtos.map(CommentMapper.map)
    }

    func postComment(matchId: MatchPreview.ID, body: String) async throws -> MatchComment {
        let currentSession = await session.currentSession()
        let authorization = authorizationPolicy.postingAuthorization(for: currentSession)

        guard authorization.allowsPosting else {
            throw AppError.unsupported(signInMessage(from: authorization))
        }

        let dto: CommentDTO = try await apiClient.post(
            "matches/\(matchId)/comments",
            body: CreateCommentRequestDTO(
                body: body,
                author: try createAuthorDTO(from: currentSession)
            )
        )
        return CommentMapper.map(dto)
    }

    private func createAuthorDTO(
        from session: UserSession
    ) throws -> CreateCommentAuthorDTO {
        switch session {
        case .guest:
            throw AppError.unsupported("Sign in to post comments.")
        case .authenticated(let profile):
            return CreateCommentAuthorDTO(
                kind: "account",
                displayName: profile.displayName,
                userId: profile.id
            )
        case .admin(let profile):
            return CreateCommentAuthorDTO(
                kind: "admin",
                displayName: profile.displayName,
                userId: profile.id
            )
        }
    }

    private func signInMessage(from authorization: CommentPostingAuthorization) -> String {
        switch authorization {
        case .allowed:
            "Unable to post comment."
        case .requiresSignIn(let message):
            message
        }
    }
}
