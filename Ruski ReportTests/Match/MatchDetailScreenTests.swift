//
//  MatchDetailScreenTests.swift
//  Ruski ReportTests
//
//  Covers the distinction between a recorded score and a bracket-only result
//  so the UI can explain source limitations without hiding known winners.
//

import Testing
@testable import Ruski_Report

struct MatchDetailScreenTests {
    @Test func bracketOnlyFinalReportsUnavailableScore() {
        let match = MatchDetail(
            id: "match-final-4-1",
            preview: MatchPreview(
                id: "match-final-4-1",
                tournamentId: "tournament-2026",
                gameType: "ruski",
                status: .final,
                participants: [
                    participant(teamId: "team-a", result: "win"),
                    participant(teamId: "team-b", result: "loss")
                ],
                score: MatchScore(
                    participants: [],
                    winnerTeamId: "team-a",
                    isFinal: true
                ),
                podId: nil,
                currentPhaseLabel: nil,
                updatedAt: "2026-08-18T00:00:00.000Z"
            ),
            boxScore: nil,
            scorecard: nil,
            events: [],
            commentsSummary: nil
        )

        #expect(MatchDetailScreen(match: match, gameDefinition: nil).isScoreUnavailable)
        #expect(
            MatchDetailScreen(
                match: PreviewData.matchDetail,
                gameDefinition: PreviewData.gameDefinition
            ).isScoreUnavailable == false
        )
    }

    private func participant(teamId: String, result: String) -> MatchParticipant {
        MatchParticipant(
            teamId: teamId,
            role: nil,
            seed: nil,
            playerIds: [],
            score: nil,
            result: result
        )
    }
}
