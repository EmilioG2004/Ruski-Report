//
//  PreviewTournamentMatches.swift
//  Ruski Report
//

import Foundation

nonisolated extension PreviewData {
    static let openingMatch = MatchPreview(
        id: "match-2026-001",
        tournamentId: tournamentPreview.id,
        gameType: "ruski",
        status: .inProgress,
        participants: [
            MatchParticipant(
                teamId: "team-1",
                role: "home",
                seed: 1,
                playerIds: ["player-alex", "player-sam"],
                score: 7,
                result: nil
            ),
            MatchParticipant(
                teamId: "team-2",
                role: "away",
                seed: 2,
                playerIds: ["player-jordan", "player-casey"],
                score: 5,
                result: nil
            )
        ],
        score: MatchScore(
            participants: [
                TeamScore(teamId: "team-1", score: 7),
                TeamScore(teamId: "team-2", score: 5)
            ],
            winnerTeamId: nil,
            isFinal: false
        ),
        podId: "pod-a",
        currentPhaseLabel: "Opening round",
        updatedAt: "2026-06-21T00:00:00.000Z"
    )

    static let secondMatch = MatchPreview(
        id: "match-2026-002",
        tournamentId: tournamentPreview.id,
        gameType: "ruski",
        status: .scheduled,
        participants: [
            MatchParticipant(
                teamId: "team-3",
                role: "home",
                seed: 3,
                playerIds: [],
                score: nil,
                result: nil
            ),
            MatchParticipant(
                teamId: "team-4",
                role: "away",
                seed: 4,
                playerIds: [],
                score: nil,
                result: nil
            )
        ],
        score: nil,
        podId: "pod-a",
        currentPhaseLabel: nil,
        updatedAt: "2026-06-21T00:00:00.000Z"
    )

    static let matchPreview = openingMatch

    static let matchDetail = MatchDetail(
        id: openingMatch.id,
        preview: openingMatch,
        boxScore: BoxScore(
            matchId: openingMatch.id,
            rows: [
                BoxScoreRow(
                    id: "player-alex",
                    label: "Alex",
                    stats: [
                        "makes": 3,
                        "misses": 2,
                        "shootingPercentage": 0.6,
                        "splashOuts": 0,
                        "guys": 0,
                        "tris": 0,
                        "dis": 1,
                        "voms": 0
                    ]
                ),
                BoxScoreRow(
                    id: "player-jordan",
                    label: "Jordan",
                    stats: [
                        "makes": 2,
                        "misses": 3,
                        "shootingPercentage": 0.4,
                        "splashOuts": 0,
                        "guys": 1,
                        "tris": 0,
                        "dis": 0,
                        "voms": 0
                    ]
                )
            ],
            totals: [
                "makes": 7,
                "misses": 5,
                "shootingPercentage": 0.583,
                "splashOuts": 0,
                "guys": 1,
                "tris": 0,
                "dis": 1,
                "voms": 0
            ]
        ),
        scorecard: Scorecard(
            columns: [
                ScorecardColumn(key: "shotNumber", label: "Shot", dataType: "number"),
                ScorecardColumn(key: "shooter", label: "Shooter", dataType: "player"),
                ScorecardColumn(key: "miss", label: "Miss", dataType: "boolean"),
                ScorecardColumn(key: "make", label: "Make", dataType: "boolean"),
                ScorecardColumn(
                    key: "splashOut",
                    label: "Splash-Out",
                    dataType: "boolean"
                ),
                ScorecardColumn(key: "guy", label: "Guy", dataType: "boolean"),
                ScorecardColumn(key: "tri", label: "Tri", dataType: "boolean"),
                ScorecardColumn(key: "di", label: "Di", dataType: "boolean"),
                ScorecardColumn(key: "vom", label: "Vom", dataType: "boolean")
            ],
            rows: [
                ScorecardRow(
                    id: "scorecard-row-1",
                    sequence: 1,
                    values: [
                        "shotNumber": "1",
                        "shooter": "Alex",
                        "miss": "false",
                        "make": "false",
                        "splashOut": "false",
                        "guy": "false",
                        "tri": "false",
                        "di": "true",
                        "vom": "false"
                    ]
                ),
                ScorecardRow(
                    id: "scorecard-row-2",
                    sequence: 2,
                    values: [
                        "shotNumber": "2",
                        "shooter": "Jordan",
                        "miss": "false",
                        "make": "false",
                        "splashOut": "false",
                        "guy": "true",
                        "tri": "false",
                        "di": "false",
                        "vom": "false"
                    ]
                ),
                ScorecardRow(
                    id: "scorecard-row-3",
                    sequence: 3,
                    values: [
                        "shotNumber": "3",
                        "shooter": "Sam",
                        "miss": "false",
                        "make": "true",
                        "splashOut": "false",
                        "guy": "false",
                        "tri": "false",
                        "di": "false",
                        "vom": "false"
                    ]
                )
            ]
        ),
        events: [
            GameEvent(
                id: "event-2026-001",
                type: "di",
                sequence: 1,
                teamId: "team-1",
                playerId: "player-alex",
                value: 2
            ),
            GameEvent(
                id: "event-2026-002",
                type: "guy",
                sequence: 2,
                teamId: "team-2",
                playerId: "player-jordan",
                value: 1
            ),
            GameEvent(
                id: "event-2026-003",
                type: "make",
                sequence: 3,
                teamId: "team-1",
                playerId: "player-sam",
                value: 1
            )
        ],
        commentsSummary: MatchCommentsSummary(
            matchId: openingMatch.id,
            count: 2,
            latestCommentAt: "2026-06-21T00:15:00.000Z"
        )
    )
}
