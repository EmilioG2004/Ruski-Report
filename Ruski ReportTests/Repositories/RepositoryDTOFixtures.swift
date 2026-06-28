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

func tournamentDetailDTO() -> TournamentDTO {
    TournamentDTO(
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
        pods: [
            TournamentPodDTO(
                id: "pod-a",
                name: "Pod A",
                sequence: 1,
                teamIds: ["team-alpha", "team-blue"],
                matchIds: ["match-1"]
            )
        ],
        teams: [
            TournamentTeamDTO(
                id: "team-alpha",
                name: "Alpha Table",
                seed: TeamSeedDTO(overall: 1, pod: 1),
                players: [
                    TournamentPlayerDTO(id: "player-alex", displayName: "Alex"),
                    TournamentPlayerDTO(id: "player-sam", displayName: "Sam")
                ]
            ),
            TournamentTeamDTO(
                id: "team-blue",
                name: "Blue Table",
                seed: TeamSeedDTO(overall: 2, pod: 2),
                players: [
                    TournamentPlayerDTO(id: "player-jordan", displayName: "Jordan"),
                    TournamentPlayerDTO(id: "player-casey", displayName: "Casey")
                ]
            )
        ],
        standings: [
            StandingDTO(
                id: "standing-team-alpha",
                podId: "pod-a",
                teamId: "team-alpha",
                rank: 1,
                record: StandingRecordDTO(wins: 1, losses: 0),
                points: 2,
                metricValues: [
                    "cupDifferential": .number(1),
                    "shootingPercentage": .number(0.556)
                ]
            )
        ],
        bracket: BracketDTO(
            id: "bracket-2026",
            rounds: [
                BracketRoundDTO(
                    id: "round-1",
                    name: "Sweet 16",
                    sequence: 1,
                    matchIds: nil,
                    matches: [
                        BracketMatchDTO(
                            id: "bracket-match-1",
                            matchId: "match-1"
                        )
                    ]
                )
            ]
        ),
        matchSummaries: [matchSummaryDTO()],
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
