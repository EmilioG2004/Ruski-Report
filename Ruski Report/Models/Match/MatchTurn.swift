//
//  MatchTurn.swift
//  Ruski Report
//
//  Defines the presentation-neutral turn hierarchy shared by Plays and
//  Scorecard so both destinations tell the same chronological story.
//

import Foundation

nonisolated struct MatchTurn: Identifiable, Equatable {
    var id: Int { number }

    let number: Int
    let teamTurns: [MatchTeamTurn]

    var hasEvents: Bool {
        teamTurns.contains { teamTurn in
            teamTurn.shots.contains { !$0.events.isEmpty }
        }
    }
}

nonisolated struct MatchTeamTurn: Identifiable, Equatable {
    var id: String {
        "\(turnNumber)-\(order)-\(teamId ?? "unknown")"
    }

    let turnNumber: Int
    let teamId: String?
    let order: Int
    let shots: [MatchTurnShot]
}

nonisolated struct MatchTurnShot: Identifiable, Equatable {
    let id: String
    let sequence: Int
    let position: Int
    let teamId: String?
    let playerId: String?
    let scorecardRow: ScorecardRow?
    let events: [GameEvent]
}
