//
//  PublicTournament.swift
//  Ruski Report
//

import Foundation

nonisolated enum PublicTournamentLifecycle: String, Equatable {
    case draftSetup = "draft_setup"
    case setupPublished = "setup_published"
    case podPlay = "pod_play"
    case seedingReview = "seeding_review"
    case playoffs
    case completed
    case archived
}

nonisolated struct PublicTournamentSummary: Identifiable, Equatable {
    let id: String
    let gameType: String
    let year: Int
    let name: String
    let lifecycle: PublicTournamentLifecycle
    let projection: PublicProjectionReference
}

nonisolated struct PublicTournamentDetail: Identifiable, Equatable {
    let id: String
    let gameType: String
    let year: Int
    let name: String
    let lifecycle: PublicTournamentLifecycle
    let projection: PublicProjectionReference
    let format: PublicTournamentFormat
    let rosters: [PublicRosterTeam]
    let pods: [PublicPod]
    let seeds: [PublicSeed]
    let statistics: [PublicStatistic]
    let matches: [PublicMatchSummary]
    let bracket: PublicBracket?

    var summary: PublicTournamentSummary {
        PublicTournamentSummary(
            id: id,
            gameType: gameType,
            year: year,
            name: name,
            lifecycle: lifecycle,
            projection: projection
        )
    }
}

nonisolated struct PublicTournamentFormat: Equatable {
    let formatVersion: Int
    let teamCount: Int
    let podCount: Int
    let podSizes: [Int]
    let playersPerTeam: Int
    let gamesPerPair: Int
    let qualifiersPerPod: Int
    let bracketSize: Int
    let allowByes: Bool
    let standingsRules: [PublicStandingsRule]
    let copiedFromPresetId: String?
}

nonisolated enum PublicStandingsRule: String, Equatable {
    case record
    case cupDifferential
    case teamShootingPercentage
    case administratorResolution
}

nonisolated struct PublicTeamIdentity: Identifiable, Equatable, Hashable {
    let id: String
    let name: String
}

nonisolated struct PublicPlayer: Identifiable, Equatable, Hashable {
    let id: String
    let displayName: String
    let rosterSlot: Int
}

nonisolated struct PublicRosterTeam: Identifiable, Equatable {
    let id: String
    let name: String
    let podId: String
    let initialPodSeed: Int
    let players: [PublicPlayer]
}

nonisolated enum PublicStandingState: String, Equatable {
    case zeroGame = "zero_game"
    case active
    case finalized
    case unresolvedTie = "unresolved_tie"
}

nonisolated struct PublicStanding: Identifiable, Equatable {
    var id: String { team.id }

    let team: PublicTeamIdentity
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

nonisolated struct PublicPod: Identifiable, Equatable {
    let id: String
    let name: String
    let sequence: Int
    let standingState: PublicStandingState
    let finalizedAt: String?
    let standings: [PublicStanding]
}

nonisolated struct PublicSeed: Identifiable, Equatable {
    var id: String { team.id }

    let team: PublicTeamIdentity
    let calculatedSeed: Int?
    let effectiveSeed: Int?
    let overridden: Bool
}

nonisolated enum PublicStatisticScope: String, Equatable {
    case match
    case player
    case team
    case pod
    case stage
    case tournament
}

nonisolated enum PublicStatisticSubject: Equatable {
    case team(PublicTeamIdentity)
    case player(id: String, displayName: String)
}

nonisolated struct PublicStatistic: Equatable {
    let scope: PublicStatisticScope
    let scopeId: String
    let stage: PublicMatchStage?
    let subject: PublicStatisticSubject?
    let values: [String: Double?]
}

nonisolated struct PublicBracket: Identifiable, Equatable {
    let id: String
    let name: String
    let size: Int
    let rounds: [PublicBracketRound]
}

nonisolated struct PublicBracketRound: Identifiable, Equatable {
    let id: String
    let name: String
    let sequence: Int
    let matches: [PublicBracketMatch]
}

nonisolated enum PublicBracketMatchStatus: String, Equatable {
    case pending
    case inProgress = "in_progress"
    case completed
    case bye
    case corrected
}

nonisolated struct PublicBracketMatch: Identifiable, Equatable {
    let id: String
    let round: Int
    let position: Int
    let status: PublicBracketMatchStatus
    let matchId: String?
    let replacedMatchId: String?
    let slots: [PublicBracketSlot]
    let winner: PublicTeamIdentity?
}

nonisolated enum PublicBracketSlot: Equatable {
    case team(PublicTeamIdentity, seed: Int?)
    case matchWinner(
        sourceBracketMatchId: String,
        team: PublicTeamIdentity?,
        seed: Int?
    )
    case bye
    case tbd
}
