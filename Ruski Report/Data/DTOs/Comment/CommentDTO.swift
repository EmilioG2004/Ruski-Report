//
//  CommentDTO.swift
//  Ruski Report
//

import Foundation

nonisolated struct CommentDTO: Decodable, Equatable {
    let id: String
    let matchId: String
    let author: CommentAuthorDTO
    let body: String
    let createdAt: String
}

nonisolated struct CommentAuthorDTO: Decodable, Equatable {
    let displayName: String
    let userId: String?

    init(displayName: String, userId: String? = nil) {
        self.displayName = displayName
        self.userId = userId
    }
}

nonisolated struct CreateCommentRequestDTO: Encodable, Equatable {
    let body: String
}
