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
            authorDisplayName: dto.author.displayName,
            body: dto.body,
            createdAt: dto.createdAt
        )
    }
}
