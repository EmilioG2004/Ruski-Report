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
            name: "Playoff Bracket",
            rounds: [
                BracketRoundDTO(
                    id: "round-1",
                    name: "Sweet 16",
                    sequence: 1,
                    matchIds: nil,
                    matches: [
                        BracketMatchDTO(
                            id: "bracket-match-1",
                            matchId: "match-1",
                            sequence: 1,
                            status: "scheduled",
                            slots: [
                                BracketSlotDTO(
                                    seed: 1,
                                    teamId: "team-alpha",
                                    source: BracketSlotSourceDTO(
                                        type: "team",
                                        sourceMatchId: nil,
                                        label: nil
                                    )
                                ),
                                BracketSlotDTO(
                                    seed: 2,
                                    teamId: "team-blue",
                                    source: BracketSlotSourceDTO(
                                        type: "team",
                                        sourceMatchId: nil,
                                        label: nil
                                    )
                                )
                            ],
                            winnerTeamId: nil
                        )
                    ]
                )
            ]
        ),
        matchSummaries: [matchSummaryDTO()],
        statistics: [
            TournamentStatisticTableDTO(
                id: "season-player-statistics",
                name: "Season Stats",
                scope: "season",
                subjectType: "player",
                statKeys: ["makes", "shootingPercentage"],
                rows: [
                    TournamentStatisticRowDTO(
                        rank: 1,
                        subject: TournamentStatisticSubjectDTO(
                            type: "player",
                            label: "Alex",
                            playerId: "player-alex",
                            teamId: "team-alpha"
                        ),
                        values: [
                            "makes": .number(10),
                            "shootingPercentage": .number(0.5)
                        ]
                    )
                ]
            )
        ],
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
        eventTypes: [
            GameEventTypeDefinitionDTO(
                id: "di",
                label: "Di",
                category: "attempt",
                affectsScore: false,
                countsAsAttempt: true,
                statKey: "dis"
            ),
            GameEventTypeDefinitionDTO(
                id: "guy",
                label: "Guy",
                category: "attempt",
                affectsScore: false,
                countsAsAttempt: true,
                statKey: "guys"
            )
        ],
        stats: [
            GameStatDefinitionDTO(
                key: "makes",
                label: "Cups Made",
                scope: "player",
                valueType: "count"
            ),
            GameStatDefinitionDTO(
                key: "shootingPercentage",
                label: "Shooting Percentage",
                scope: "player",
                valueType: "percentage"
            ),
            GameStatDefinitionDTO(
                key: "dis",
                label: "Di",
                scope: "player",
                valueType: "count"
            )
        ],
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
        boxScore: BoxScoreDTO(
            matchId: "match-1",
            rows: [
                BoxScoreRowDTO(
                    subject: BoxScoreSubjectDTO(
                        type: "player",
                        label: "Alex",
                        playerId: "player-alex",
                        teamId: "team-alpha"
                    ),
                    stats: [
                        "makes": .number(2),
                        "shootingPercentage": .number(0.667),
                        "dis": .number(1)
                    ]
                )
            ],
            totals: [
                "makes": .number(2),
                "shootingPercentage": .number(0.667),
                "dis": .number(1)
            ]
        ),
        scorecard: ScorecardDTO(
            definition: ScorecardDefinitionDTO(
                columns: [
                    ScorecardColumnDTO(
                        key: "shotNumber",
                        label: "Shot",
                        dataType: "number"
                    ),
                    ScorecardColumnDTO(
                        key: "shooter",
                        label: "Shooter",
                        dataType: "player"
                    ),
                    ScorecardColumnDTO(
                        key: "di",
                        label: "Di",
                        dataType: "boolean"
                    )
                ]
            ),
            rows: [
                ScorecardRowDTO(
                    id: "scorecard-row-1",
                    sequence: 1,
                    values: [
                        "shotNumber": .number(1),
                        "shooter": .string("Alex"),
                        "di": .bool(true)
                    ]
                )
            ]
        ),
        events: [
            GameEventDTO(
                id: "event-1",
                type: "di",
                sequence: 1,
                teamId: "team-alpha",
                playerId: "player-alex",
                value: 2
            )
        ],
        commentsSummary: CommentsSummaryDTO(
            matchId: "match-1",
            count: 1,
            latestCommentAt: "2026-06-21T00:15:00.000Z"
        ),
        version: 1,
        updatedAt: "2026-06-21T00:00:00.000Z"
    )
}

func commentDTO() -> CommentDTO {
    CommentDTO(
        id: "comment-1",
        matchId: "match-1",
        author: CommentAuthorDTO(displayName: "Alex"),
        body: "Great match.",
        createdAt: "2026-06-21T00:18:00.000Z"
    )
}
