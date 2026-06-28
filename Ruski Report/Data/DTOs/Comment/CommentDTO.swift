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
}

nonisolated struct CreateCommentRequestDTO: Encodable, Equatable {
    let body: String
    let author: CreateCommentAuthorDTO
}

nonisolated struct CreateCommentAuthorDTO: Encodable, Equatable {
    let kind: String
    let displayName: String
    let userId: String?
}
