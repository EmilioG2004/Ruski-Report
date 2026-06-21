//
//  MatchModels.swift
//  Ruski Report
//

import Foundation

nonisolated struct MatchPreview: Identifiable, Equatable {
    let id: String
    let tournamentId: String
    let gameType: String
    let status: MatchStatus
    let participants: [MatchParticipant]
    let score: MatchScore?
    let podId: String?
    let currentPhaseLabel: String?
    let updatedAt: String
}

nonisolated struct MatchDetail: Identifiable, Equatable {
    let id: String
    let preview: MatchPreview
    let boxScore: BoxScore?
    let scorecard: Scorecard?
    let events: [GameEvent]
}

nonisolated enum MatchStatus: Equatable {
    case scheduled
    case inProgress
    case final
    case unknown(String)

    var displayName: String {
        switch self {
        case .scheduled:
            "Scheduled"
        case .inProgress:
            "In Progress"
        case .final:
            "Final"
        case .unknown(let value):
            value.isEmpty ? "Unknown" : value.capitalized
        }
    }
}

nonisolated struct MatchParticipant: Equatable {
    let teamId: String
    let role: String?
    let seed: Int?
    let playerIds: [String]
    let score: Int?
    let result: String?
}

nonisolated struct MatchScore: Equatable {
    let participants: [TeamScore]
    let winnerTeamId: String?
    let isFinal: Bool
}

nonisolated struct TeamScore: Equatable {
    let teamId: String
    let score: Int
}

nonisolated struct BoxScore: Equatable {
    let matchId: String
    let rows: [BoxScoreRow]
    let totals: [String: Double]
}

nonisolated struct BoxScoreRow: Identifiable, Equatable {
    let id: String
    let label: String
    let stats: [String: Double]
}

nonisolated struct Scorecard: Equatable {
    let columns: [ScorecardColumn]
    let rows: [ScorecardRow]
}

nonisolated struct ScorecardColumn: Identifiable, Equatable {
    var id: String { key }

    let key: String
    let label: String
    let dataType: String
}

nonisolated struct ScorecardRow: Identifiable, Equatable {
    let id: String
    let sequence: Int
    let values: [String: String]
}

nonisolated struct GameEvent: Identifiable, Equatable {
    let id: String
    let type: String
    let sequence: Int
    let teamId: String?
    let playerId: String?
    let value: Double?
}
