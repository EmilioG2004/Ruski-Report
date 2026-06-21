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

    static let matchPreview = MatchPreview(
        id: "match-2026-001",
        tournamentId: tournamentPreview.id,
        gameType: "ruski",
        status: .scheduled,
        participants: [],
        score: nil,
        podId: "pod-a",
        currentPhaseLabel: nil,
        updatedAt: "2026-06-21T00:00:00.000Z"
    )

    static let tournamentDetail = TournamentDetail(
        id: tournamentPreview.id,
        preview: tournamentPreview,
        pods: [
            TournamentPod(
                id: "pod-a",
                name: "Pod A",
                sequence: 1,
                teamIds: [],
                matchIds: [matchPreview.id]
            )
        ],
        teams: [],
        standings: [],
        bracket: nil,
        matches: [matchPreview]
    )

    static let matchDetail = MatchDetail(
        id: matchPreview.id,
        preview: matchPreview,
        boxScore: nil,
        scorecard: nil,
        events: []
    )
}
