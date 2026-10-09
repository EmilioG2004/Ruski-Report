//
//  PublicMatch.swift
//  Ruski Report
//

import Foundation

nonisolated enum PublicMatchStage: String, Equatable {
    case podPlay = "pod_play"
    case playoffs
}

nonisolated enum PublicMatchStatus: String, Equatable {
    case scheduled
    case inProgress = "in_progress"
    case final
    case forfeited
    case cancelled
    case postponed
}

nonisolated enum PublicScoreAvailability: String, Equatable {
    case notStarted = "not_started"
    case partial
    case complete
    case unrecorded
    case notApplicable = "not_applicable"
}

nonisolated enum PublicParticipantRole: String, Equatable {
    case home
    case away
}

nonisolated enum PublicParticipantResult: String, Equatable {
    case win
    case loss
    case tie
    case cancelled
    case forfeited
}

nonisolated struct PublicMatchParticipant: Equatable {
    let side: Int
    let role: PublicParticipantRole
    let team: PublicTeamIdentity
    let players: [PublicPlayer]
    let seed: Int?
    let score: Int?
    let result: PublicParticipantResult?
}

nonisolated struct PublicMatchCorrection: Equatable {
    let isCorrection: Bool
    let reason: String?
    let previousRevision: Int?
    let replacesMatchId: String?
    let replacedByMatchId: String?
}

nonisolated struct PublicMatchTimestamps: Equatable {
    let scheduledAt: String?
    let startedAt: String?
    let endedAt: String?
    let updatedAt: String
}

nonisolated struct PublicMatchSummary: Identifiable, Equatable {
    let id: String
    let tournamentId: String
    let projection: PublicProjectionReference
    let stage: PublicMatchStage
    let sequence: Int
    let podId: String?
    let bracketMatchId: String?
    let instance: Int
    let revision: Int?
    let status: PublicMatchStatus
    let scoreAvailability: PublicScoreAvailability
    let correction: PublicMatchCorrection
    let timestamps: PublicMatchTimestamps
    let participants: [PublicMatchParticipant]
    let winner: PublicTeamIdentity?
}

nonisolated struct PublicMatchEvent: Identifiable, Equatable {
    let id: String
    let sequence: Int
    let type: String
    let teamId: String?
    let playerId: String?
    let occurredAt: String?
    let details: [String: JSONValue]
}

nonisolated enum PublicBoxScoreColumnFormat: String, Equatable {
    case integer
    case percentage
}

nonisolated struct PublicBoxScoreColumn: Identifiable, Equatable {
    var id: String { key }

    let key: String
    let label: String
    let format: PublicBoxScoreColumnFormat
}

nonisolated enum PublicBoxScoreSubjectType: String, Equatable {
    case player
    case team
}

nonisolated struct PublicBoxScoreRow: Identifiable, Equatable {
    let id: String
    let subjectId: String
    let subjectDisplayName: String
    let subjectType: PublicBoxScoreSubjectType
    let teamId: String
    let values: [String: Double?]
}

nonisolated struct PublicBoxScore: Equatable {
    let columns: [PublicBoxScoreColumn]
    let rows: [PublicBoxScoreRow]
    let totals: [String: Double?]
}

nonisolated enum PublicScorecardColumnKind: String, Equatable {
    case sequence
    case participant
    case value
    case marker
}

nonisolated struct PublicScorecardColumn: Identifiable, Equatable {
    var id: String { key }

    let key: String
    let label: String
    let kind: PublicScorecardColumnKind
}

nonisolated struct PublicScorecardRow: Identifiable, Equatable {
    let id: String
    let sequence: Int
    let side: Int
    let teamId: String
    let playerId: String?
    let playerDisplayName: String?
    let values: [String: JSONValue]
}

nonisolated struct PublicScorecard: Equatable {
    let columns: [PublicScorecardColumn]
    let rows: [PublicScorecardRow]
}

nonisolated struct PublicMatchDetail: Identifiable, Equatable {
    let id: String
    let summary: PublicMatchSummary
    let events: [PublicMatchEvent]
    let statistics: [PublicStatistic]
    let boxScore: PublicBoxScore?
    let scorecard: PublicScorecard?
}
