//
//  PreviewTournamentTeams.swift
//  Ruski Report
//

import Foundation

nonisolated extension PreviewData {
    static let teams = [
        TournamentTeam(id: "team-1", name: "Table One", seed: 1, players: []),
        TournamentTeam(id: "team-2", name: "Downtown", seed: 2, players: []),
        TournamentTeam(id: "team-3", name: "North Durham", seed: 3, players: []),
        TournamentTeam(id: "team-4", name: "South Club", seed: 4, players: [])
    ]

    static let standings = [
        PodStanding(
            id: "standing-1",
            podId: "pod-a",
            teamId: "team-1",
            rank: 1,
            wins: 1,
            losses: 0,
            points: 3,
            cupDifferential: 2,
            shootingPercentage: 0.58
        ),
        PodStanding(
            id: "standing-2",
            podId: "pod-a",
            teamId: "team-2",
            rank: 2,
            wins: 0,
            losses: 1,
            points: 1,
            cupDifferential: -2,
            shootingPercentage: 0.47
        )
    ]
}
