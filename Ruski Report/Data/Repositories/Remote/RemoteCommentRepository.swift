//
//  RemoteCommentRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class RemoteCommentRepository: CommentRepository {
    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    func comments(matchId: MatchPreview.ID) async throws -> [MatchComment] {
        let dtos: [CommentDTO] = try await apiClient.get("matches/\(matchId)/comments")
        return dtos.map(CommentMapper.map)
    }

    func postComment(matchId: MatchPreview.ID, body: String) async throws -> MatchComment {
        let dto: CommentDTO = try await apiClient.post(
            "matches/\(matchId)/comments",
            body: CreateCommentRequestDTO(body: body)
        )
        return CommentMapper.map(dto)
    }
}
