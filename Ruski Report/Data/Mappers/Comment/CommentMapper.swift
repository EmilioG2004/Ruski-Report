//
//  CommentMapper.swift
//  Ruski Report
//

import Foundation

nonisolated enum CommentMapper {
    static func map(_ dto: CommentDTO) -> MatchComment {
        MatchComment(
            id: dto.id,
            matchId: dto.matchId,
            authorUserId: dto.author.userId,
            authorDisplayName: dto.author.displayName,
            body: dto.body,
            createdAt: dto.createdAt
        )
    }
}
