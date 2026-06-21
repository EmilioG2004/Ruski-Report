//
//  RepositoryDTOFixtures.swift
//  Ruski ReportTests
//

@testable import Ruski_Report

func tournamentSummaryDTO() -> TournamentSummaryDTO {
    TournamentSummaryDTO(
        id: "tournament-2026",
        year: 2026,
        name: "2026 Ruski Tournament",
        gameType: "ruski",
        status: "active",
        format: TournamentFormatDTO(
            type: "pod_and_bracket",
            podCount: 8,
            teamsPerPod: 4,
            bracketSize: 16,
            description: "Pod play and championship bracket"
        ),
        activeMatchIds: ["match-1"],
        featuredMatchIds: ["match-1"],
        version: 1,
        updatedAt: "2026-06-21T00:00:00.000Z",
        metadata: ["locationName": .string("Durham")]
    )
}

func gameDefinitionDTO() -> GameDefinitionDTO {
    GameDefinitionDTO(
        gameType: "ruski",
        displayName: "Ruski",
        scorecardDefinitionId: "ruski-scorecard",
        phases: [
            GamePhaseDefinitionDTO(id: "normal", label: "Normal Play", sequence: 1)
        ],
        eventTypes: [],
        stats: []
    )
}

func matchSummaryDTO() -> MatchSummaryDTO {
    MatchSummaryDTO(
        id: "match-1",
        tournamentId: "tournament-2026",
        gameType: "ruski",
        status: "scheduled",
        participants: [],
        score: nil,
        podId: "pod-a",
        currentPhase: nil,
        version: 1,
        updatedAt: "2026-06-21T00:00:00.000Z"
    )
}

func matchDetailDTO() -> MatchDetailDTO {
    MatchDetailDTO(
        id: "match-1",
        tournamentId: "tournament-2026",
        gameType: "ruski",
        status: "scheduled",
        participants: [],
        score: nil,
        podId: "pod-a",
        currentPhase: nil,
        boxScore: nil,
        scorecard: nil,
        events: [],
        version: 1,
        updatedAt: "2026-06-21T00:00:00.000Z"
    )
}
