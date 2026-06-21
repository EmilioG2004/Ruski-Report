//
//  PreviewData.swift
//  Ruski Report
//

import Foundation

nonisolated enum PreviewData {
    static let tournamentPreview = TournamentPreview(
        id: "tournament-2026",
        year: 2026,
        name: "2026 Ruski Tournament",
        status: .scheduled,
        formatSummary: "Pod play and championship bracket",
        locationName: "Durham Ruski Club",
        featuredMatchCount: 1
    )

    static let gameDefinition = GameDefinition(
        gameType: "ruski",
        displayName: "Ruski",
        scorecardDefinitionId: "ruski-scorecard",
        phases: [
            GamePhaseDefinition(id: "normal", label: "Normal Play", sequence: 1),
            GamePhaseDefinition(id: "overtime", label: "Overtime", sequence: 2)
        ],
        eventTypes: [],
        stats: []
    )

    static let tournamentDetail = TournamentDetail(
        id: tournamentPreview.id,
        preview: tournamentPreview,
        pods: [
            TournamentPod(
                id: "pod-a",
                name: "Pod A",
                sequence: 1,
                teamIds: teams.map(\.id),
                matchIds: [openingMatch.id, secondMatch.id]
            )
        ],
        teams: teams,
        standings: standings,
        bracket: TournamentBracket(
            id: "bracket-2026",
            rounds: [
                BracketRound(
                    id: "round-1",
                    name: "Semifinals",
                    sequence: 1,
                    matchIds: [openingMatch.id, secondMatch.id]
                )
            ]
        ),
        matches: [openingMatch, secondMatch]
    )
}
