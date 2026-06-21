//
//  TournamentDetail.swift
//  Ruski Report
//

import Foundation

nonisolated struct TournamentDetail: Identifiable, Equatable {
    let id: String
    let preview: TournamentPreview
    let pods: [TournamentPod]
    let teams: [TournamentTeam]
    let standings: [PodStanding]
    let bracket: TournamentBracket?
    let matches: [MatchPreview]
}

nonisolated struct TournamentPod: Identifiable, Equatable {
    let id: String
    let name: String
    let sequence: Int
    let teamIds: [String]
    let matchIds: [String]
}

nonisolated struct TournamentTeam: Identifiable, Equatable {
    let id: String
    let name: String
    let seed: Int?
    let players: [TournamentPlayer]
}

nonisolated struct TournamentPlayer: Identifiable, Equatable {
    let id: String
    let displayName: String
}

nonisolated struct PodStanding: Identifiable, Equatable {
    let id: String
    let podId: String?
    let teamId: String
    let rank: Int
    let wins: Int
    let losses: Int
    let points: Int?
    let cupDifferential: Double?
    let shootingPercentage: Double?
}

nonisolated struct TournamentBracket: Equatable {
    let id: String
    let rounds: [BracketRound]
}

nonisolated struct BracketRound: Identifiable, Equatable {
    let id: String
    let name: String
    let sequence: Int
    let matchIds: [String]
}
