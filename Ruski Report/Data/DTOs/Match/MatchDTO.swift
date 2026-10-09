//
//  MatchDTO.swift
//  Ruski Report
//

import Foundation

nonisolated struct MatchSummaryDTO: Decodable, Equatable {
    let id: String
    let tournamentId: String
    let gameType: String
    let status: String
    let participants: [MatchParticipantDTO]
    let score: MatchScoreDTO?
    let podId: String?
    let currentPhase: GamePhaseStateDTO?
    let version: Int
    let updatedAt: String
}

nonisolated struct MatchDetailDTO: Decodable, Equatable {
    let id: String
    let tournamentId: String
    let gameType: String
    let status: String
    let participants: [MatchParticipantDTO]
    let score: MatchScoreDTO?
    let podId: String?
    let currentPhase: GamePhaseStateDTO?
    let boxScore: BoxScoreDTO?
    let scorecard: ScorecardDTO?
    let events: [GameEventDTO]
    let commentsSummary: CommentsSummaryDTO?
    let version: Int
    let updatedAt: String
}

nonisolated struct MatchParticipantDTO: Decodable, Equatable {
    let teamId: String
    let role: String?
    let seed: Int?
    let playerIds: [String]?
    let score: Int?
    let result: String?
}

nonisolated struct MatchScoreDTO: Decodable, Equatable {
    let participants: [TeamScoreDTO]
    let winnerTeamId: String?
    let isFinal: Bool
}

nonisolated struct TeamScoreDTO: Decodable, Equatable {
    let teamId: String
    let score: Int
}

nonisolated struct GamePhaseStateDTO: Decodable, Equatable {
    let id: String
    let label: String
    let sequence: Int
    let status: String?
}

nonisolated struct BoxScoreDTO: Decodable, Equatable {
    let matchId: String
    let rows: [BoxScoreRowDTO]
    let totals: [String: JSONValue]?
}

nonisolated struct BoxScoreRowDTO: Decodable, Equatable {
    let subject: BoxScoreSubjectDTO
    let stats: [String: JSONValue]
}

nonisolated struct BoxScoreSubjectDTO: Decodable, Equatable {
    let type: String
    let label: String
    let playerId: String?
    let teamId: String?
}

nonisolated struct ScorecardDTO: Decodable, Equatable {
    let definition: ScorecardDefinitionDTO
    let rows: [ScorecardRowDTO]
}

nonisolated struct ScorecardDefinitionDTO: Decodable, Equatable {
    let columns: [ScorecardColumnDTO]
}

nonisolated struct ScorecardColumnDTO: Decodable, Equatable {
    let key: String
    let label: String
    let dataType: String
}

nonisolated struct ScorecardRowDTO: Decodable, Equatable {
    let id: String
    let sequence: Int
    let teamId: String?
    let playerId: String?
    let values: [String: JSONValue]
    let eventIds: [String]?
    let metadata: [String: JSONValue]?
}

nonisolated struct GameEventDTO: Decodable, Equatable {
    let id: String
    let type: String
    let sequence: Int
    let teamId: String?
    let playerId: String?
    let value: Double?
    let metadata: [String: JSONValue]?
}

nonisolated struct CommentsSummaryDTO: Decodable, Equatable {
    let matchId: String
    let count: Int
    let latestCommentAt: String?
}
