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
                playerIds: [],
                score: 7,
                result: nil
            ),
            MatchParticipant(
                teamId: "team-2",
                role: "away",
                seed: 2,
                playerIds: [],
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
        boxScore: nil,
        scorecard: nil,
        events: []
    )
}
