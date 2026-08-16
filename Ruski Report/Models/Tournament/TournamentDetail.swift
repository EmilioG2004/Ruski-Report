//
//  TournamentDetail.swift
//  Ruski Report
//

import Foundation

nonisolated struct TournamentDetail: Identifiable, Equatable {
    let id: String
    let gameType: String
    let preview: TournamentPreview
    let pods: [TournamentPod]
    let teams: [TournamentTeam]
    let standings: [PodStanding]
    let bracket: TournamentBracket?
    let matches: [MatchPreview]
    let statistics: [TournamentStatisticTable]
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
    let matches: [TournamentBracketMatch]
}

nonisolated struct TournamentBracketMatch: Identifiable, Equatable {
    let id: String
    let matchId: String?
    let sequence: Int
    let status: String
    let slots: [TournamentBracketSlot]
    let winnerTeamId: String?
}

nonisolated struct TournamentBracketSlot: Equatable {
    let seed: Int?
    let teamId: String?
    let source: TournamentBracketSlotSource?
}

nonisolated struct TournamentBracketSlotSource: Equatable {
    let type: String
    let sourceMatchId: String?
    let label: String?
}

nonisolated struct TournamentStatisticTable: Identifiable, Equatable {
    let id: String
    let name: String
    let scope: String
    let subjectType: String
    let statKeys: [String]
    let rows: [TournamentStatisticRow]
}

nonisolated struct TournamentStatisticRow: Identifiable, Equatable {
    var id: String {
        subject.playerId ?? subject.teamId ?? "\(rank)-\(subject.label)"
    }

    let rank: Int
    let subject: TournamentStatisticSubject
    let values: [String: Double]
}

nonisolated struct TournamentStatisticSubject: Equatable {
    let type: String
    let label: String
    let playerId: String?
    let teamId: String?
}
