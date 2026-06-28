//
//  PreviewComments.swift
//  Ruski Report
//

import Foundation

nonisolated extension PreviewData {
    static let matchComments = [
        MatchComment(
            id: "comment-preview-1",
            matchId: openingMatch.id,
            authorDisplayName: "Alex",
            body: "Alpha Table is one cup away from closing this out.",
            createdAt: "2026-06-21T00:12:00.000Z"
        ),
        MatchComment(
            id: "comment-preview-2",
            matchId: openingMatch.id,
            authorDisplayName: "Sam",
            body: "Blue Table still has redemption if this round ends now.",
            createdAt: "2026-06-21T00:15:00.000Z"
        )
    ]
}
