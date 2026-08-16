//
//  TournamentDTO.swift
//  Ruski Report
//

import Foundation

nonisolated struct TournamentSummaryDTO: Decodable, Equatable {
    let id: String
    let year: Int
    let name: String
    let gameType: String
    let status: String
    let format: TournamentFormatDTO
    let activeMatchIds: [String]
    let featuredMatchIds: [String]
    let version: Int
    let updatedAt: String
    let metadata: [String: JSONValue]?
}

nonisolated struct TournamentDTO: Decodable, Equatable {
    let id: String
    let year: Int
    let name: String
    let gameType: String
    let status: String
    let format: TournamentFormatDTO
    let activeMatchIds: [String]
    let featuredMatchIds: [String]
    let pods: [TournamentPodDTO]
    let teams: [TournamentTeamDTO]
    let standings: [StandingDTO]
    let bracket: BracketDTO?
    let matchSummaries: [MatchSummaryDTO]
    let statistics: [TournamentStatisticTableDTO]?
    let version: Int
    let updatedAt: String
    let metadata: [String: JSONValue]?
}

nonisolated struct TournamentFormatDTO: Decodable, Equatable {
    let type: String
    let podCount: Int?
    let teamsPerPod: Int?
    let bracketSize: Int?
    let description: String?
}

nonisolated struct TournamentPodDTO: Decodable, Equatable {
    let id: String
    let name: String
    let sequence: Int
    let teamIds: [String]
    let matchIds: [String]?
}

nonisolated struct TournamentTeamDTO: Decodable, Equatable {
    let id: String
    let name: String
    let seed: TeamSeedDTO?
    let players: [TournamentPlayerDTO]
}

nonisolated struct TeamSeedDTO: Decodable, Equatable {
    let overall: Int?
    let pod: Int?
}

nonisolated struct TournamentPlayerDTO: Decodable, Equatable {
    let id: String
    let displayName: String
}

nonisolated struct StandingDTO: Decodable, Equatable {
    let id: String
    let podId: String?
    let teamId: String
    let rank: Int
    let record: StandingRecordDTO
    let points: Int?
    let metricValues: [String: JSONValue]?
}

nonisolated struct StandingRecordDTO: Decodable, Equatable {
    let wins: Int
    let losses: Int
}

nonisolated struct BracketDTO: Decodable, Equatable {
    let id: String
    let name: String?
    let rounds: [BracketRoundDTO]
}

nonisolated struct BracketRoundDTO: Decodable, Equatable {
    let id: String
    let name: String
    let sequence: Int
    let matchIds: [String]?
    let matches: [BracketMatchDTO]?
}

nonisolated struct BracketMatchDTO: Decodable, Equatable {
    let id: String
    let matchId: String?
    let sequence: Int?
    let status: String?
    let slots: [BracketSlotDTO]?
    let winnerTeamId: String?
}

nonisolated struct BracketSlotDTO: Decodable, Equatable {
    let seed: Int?
    let teamId: String?
    let source: BracketSlotSourceDTO?
}

nonisolated struct BracketSlotSourceDTO: Decodable, Equatable {
    let type: String
    let sourceMatchId: String?
    let label: String?
}

nonisolated struct TournamentStatisticTableDTO: Decodable, Equatable {
    let id: String
    let name: String
    let scope: String
    let subjectType: String
    let statKeys: [String]
    let rows: [TournamentStatisticRowDTO]
}

nonisolated struct TournamentStatisticRowDTO: Decodable, Equatable {
    let rank: Int
    let subject: TournamentStatisticSubjectDTO
    let values: [String: JSONValue]
}

nonisolated struct TournamentStatisticSubjectDTO: Decodable, Equatable {
    let type: String
    let label: String
    let playerId: String?
    let teamId: String?
}
