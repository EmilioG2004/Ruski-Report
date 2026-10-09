//
//  PublicMatchDTO.swift
//  Ruski Report
//

import Foundation

nonisolated struct PublicMatchParticipantDTO: Decodable, Equatable {
    let side: Int
    let role: String
    let team: PublicTeamIdentityDTO
    let players: [PublicPlayerDTO]
    let seed: Int?
    let score: Int?
    let result: String?
}

nonisolated struct PublicMatchCorrectionDTO: Decodable, Equatable {
    let isCorrection: Bool
    let reason: String?
    let previousRevision: Int?
    let replacesMatchId: String?
    let replacedByMatchId: String?
}

nonisolated struct PublicMatchTimestampsDTO: Decodable, Equatable {
    let scheduledAt: String?
    let startedAt: String?
    let endedAt: String?
    let updatedAt: String
}

nonisolated struct PublicMatchSummaryDTO: Decodable, Equatable {
    let id: String
    let stage: String
    let sequence: Int
    let podId: String?
    let bracketMatchId: String?
    let instance: Int
    let revision: Int?
    let status: String
    let scoreAvailability: String
    let correction: PublicMatchCorrectionDTO
    let timestamps: PublicMatchTimestampsDTO
    let participants: [PublicMatchParticipantDTO]
    let winner: PublicTeamIdentityDTO?
}

nonisolated struct PublicMatchEventDTO: Decodable, Equatable {
    let id: String
    let sequence: Int
    let type: String
    let teamId: String?
    let playerId: String?
    let occurredAt: String?
    let details: [String: JSONValue]
}

nonisolated struct PublicBoxScoreColumnDTO: Decodable, Equatable {
    let key: String
    let label: String
    let format: String
}

nonisolated struct PublicBoxScoreSubjectDTO: Decodable, Equatable {
    let id: String
    let displayName: String
    let type: String
}

nonisolated struct PublicBoxScoreRowDTO: Decodable, Equatable {
    let id: String
    let subject: PublicBoxScoreSubjectDTO
    let teamId: String
    let values: [String: Double?]
}

nonisolated struct PublicBoxScoreDTO: Decodable, Equatable {
    let columns: [PublicBoxScoreColumnDTO]
    let rows: [PublicBoxScoreRowDTO]
    let totals: [String: Double?]
}

nonisolated struct PublicScorecardColumnDTO: Decodable, Equatable {
    let key: String
    let label: String
    let kind: String
}

nonisolated struct PublicScorecardRowDTO: Decodable, Equatable {
    let id: String
    let sequence: Int
    let side: Int
    let teamId: String
    let playerId: String?
    let playerDisplayName: String?
    let values: [String: JSONValue]
}

nonisolated struct PublicScorecardDTO: Decodable, Equatable {
    let columns: [PublicScorecardColumnDTO]
    let rows: [PublicScorecardRowDTO]
}

nonisolated struct PublicMatchDTO: Decodable, Equatable {
    let id: String
    let stage: String
    let sequence: Int
    let podId: String?
    let bracketMatchId: String?
    let instance: Int
    let revision: Int?
    let status: String
    let scoreAvailability: String
    let correction: PublicMatchCorrectionDTO
    let timestamps: PublicMatchTimestampsDTO
    let participants: [PublicMatchParticipantDTO]
    let winner: PublicTeamIdentityDTO?
    let events: [PublicMatchEventDTO]
    let statistics: [PublicStatisticDTO]
    let boxScore: PublicBoxScoreDTO?
    let scorecard: PublicScorecardDTO?
}
