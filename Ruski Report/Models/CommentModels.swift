//
//  CommentModels.swift
//  Ruski Report
//

import Foundation

nonisolated struct MatchComment: Identifiable, Equatable {
    let id: String
    let matchId: String
    let authorDisplayName: String
    let body: String
    let createdAt: String
}
