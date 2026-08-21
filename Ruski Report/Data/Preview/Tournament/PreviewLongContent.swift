//
//  PreviewLongContent.swift
//  Ruski Report
//
//  Supplies intentionally oversized labels and identities for layout and
//  Dynamic Type regression previews without relying on live services.
//

import Foundation

nonisolated extension PreviewData {
    static let longContentTournamentPreview = TournamentPreview(
        id: tournamentPreview.id,
        year: tournamentPreview.year,
        name: "The 2026 Durham Ruski Club Global Championship Invitational",
        status: .active,
        formatSummary: "Extended pod play followed by the championship elimination bracket",
        locationName: "Durham Ruski Club — Historic North Campus Longtable Pavilion",
        featuredMatchCount: tournamentDetail.matches.count
    )

    static let longContentTeams: [TournamentTeam] = [
        TournamentTeam(
            id: "team-1",
            name: "North Durham Longtable Society of Extremely Confident Shooters",
            seed: 1,
            players: [
                TournamentPlayer(
                    id: "player-alex",
                    displayName: "Alexandria Catherine Montgomery-Sinclair"
                ),
                TournamentPlayer(
                    id: "player-sam",
                    displayName: "Samuel Theodore van der Longtable"
                )
            ]
        ),
        TournamentTeam(
            id: "team-2",
            name: "West Campus Alumni and Visiting International Champions",
            seed: 2,
            players: [
                TournamentPlayer(
                    id: "player-jordan",
                    displayName: "Jordan Maximilian Worthington"
                ),
                TournamentPlayer(
                    id: "player-casey",
                    displayName: "Casey Elizabeth-Rose Fitzpatrick"
                )
            ]
        ),
        TournamentTeam(
            id: "team-3",
            name: "The Unreasonably Long North Campus Longtable Association",
            seed: 3,
            players: []
        ),
        TournamentTeam(
            id: "team-4",
            name: "South Club Championship Committee and Friends",
            seed: 4,
            players: []
        )
    ]

    static let longContentTournamentDetail = TournamentDetail(
        id: longContentTournamentPreview.id,
        gameType: tournamentDetail.gameType,
        preview: longContentTournamentPreview,
        pods: tournamentDetail.pods,
        teams: longContentTeams,
        standings: tournamentDetail.standings,
        bracket: tournamentDetail.bracket,
        matches: tournamentDetail.matches,
        statistics: tournamentDetail.statistics
    )
}
