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
            body: CreateCommentRequestDTO(body: body)
        )
        return CommentMapper.map(dto)
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
