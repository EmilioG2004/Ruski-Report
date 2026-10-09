//
//  PublicTournamentDTO.swift
//  Ruski Report
//

import Foundation

nonisolated struct PublicTournamentSummaryDTO: Decodable, Equatable {
    let id: String
    let gameType: String
    let year: Int
    let name: String
    let lifecycle: String
}

nonisolated struct PublicTournamentDTO: Decodable, Equatable {
    let id: String
    let gameType: String
    let year: Int
    let name: String
    let lifecycle: String
    let format: PublicTournamentFormatDTO
    let rosters: [PublicRosterTeamDTO]
    let pods: [PublicPodDTO]
    let seeds: [PublicSeedDTO]
    let statistics: [PublicStatisticDTO]
    let matches: [PublicMatchSummaryDTO]
    let bracket: PublicBracketDTO?
}

nonisolated struct PublicTournamentFormatDTO: Decodable, Equatable {
    let formatVersion: Int
    let formatType: String
    let teamCount: Int
    let podCount: Int
    let podSizes: [Int]
    let playersPerTeam: Int
    let gamesPerPair: Int
    let qualifiersPerPod: Int
    let bracketSize: Int
    let allowByes: Bool
    let standingsRules: [String]
    let copiedFromPresetId: String?
}

nonisolated struct PublicTeamIdentityDTO: Decodable, Equatable {
    let id: String
    let name: String
}

nonisolated struct PublicPlayerDTO: Decodable, Equatable {
    let id: String
    let displayName: String
    let rosterSlot: Int
}

nonisolated struct PublicRosterTeamDTO: Decodable, Equatable {
    let id: String
    let name: String
    let podId: String
    let initialPodSeed: Int
    let players: [PublicPlayerDTO]
}

nonisolated struct PublicStandingDTO: Decodable, Equatable {
    let team: PublicTeamIdentityDTO
    let rank: Int?
    let wins: Int
    let losses: Int
    let cupDifferential: Int
    let makes: Int
    let attempts: Int
    let shootingPercentage: Double?
    let tieGroup: String?
    let administratorResolved: Bool
}

nonisolated struct PublicPodDTO: Decodable, Equatable {
    let id: String
    let name: String
    let sequence: Int
    let standingState: String
    let finalizedAt: String?
    let standings: [PublicStandingDTO]
}

nonisolated struct PublicSeedDTO: Decodable, Equatable {
    let team: PublicTeamIdentityDTO
    let calculatedSeed: Int?
    let effectiveSeed: Int?
    let overridden: Bool
}

nonisolated struct PublicStatisticSubjectDTO: Decodable, Equatable {
    let id: String
    let name: String?
    let displayName: String?
}

nonisolated struct PublicStatisticDTO: Decodable, Equatable {
    let scope: String
    let scopeId: String
    let stage: String?
    let subject: PublicStatisticSubjectDTO?
    let values: [String: Double?]
}

nonisolated struct PublicBracketDTO: Decodable, Equatable {
    let id: String
    let name: String
    let size: Int
    let rounds: [PublicBracketRoundDTO]
}

nonisolated struct PublicBracketRoundDTO: Decodable, Equatable {
    let id: String
    let name: String
    let sequence: Int
    let matches: [PublicBracketMatchDTO]
}

nonisolated struct PublicBracketMatchDTO: Decodable, Equatable {
    let id: String
    let round: Int
    let position: Int
    let status: String
    let matchId: String?
    let replacedMatchId: String?
    let slots: [PublicBracketSlotDTO]
    let winner: PublicTeamIdentityDTO?
}

nonisolated struct PublicBracketSlotDTO: Decodable, Equatable {
    let source: String
    let sourceBracketMatchId: String?
    let team: PublicTeamIdentityDTO?
    let seed: Int?
}
