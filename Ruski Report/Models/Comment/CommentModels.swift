//
//  CommentModels.swift
//  Ruski Report
//

import Foundation

nonisolated struct MatchComment: Identifiable, Equatable {
    let id: String
    let matchId: String
    let authorUserId: String?
    let authorDisplayName: String
    let body: String
    let createdAt: String

    init(
        id: String,
        matchId: String,
        authorUserId: String? = nil,
        authorDisplayName: String,
        body: String,
        createdAt: String
    ) {
        self.id = id
        self.matchId = matchId
        self.authorUserId = authorUserId
        self.authorDisplayName = authorDisplayName
        self.body = body
        self.createdAt = createdAt
    }
}
