//
//  MatchTurnProjectorTests.swift
//  Ruski ReportTests
//
//  Verifies that both match panels receive the same alternating team and
//  shooter hierarchy from normalized scorecard data.
//

import Testing
@testable import Ruski_Report

struct MatchTurnProjectorTests {
    @Test func groupsBothShootersBeforePassingToTheSecondTeam() {
        let screen = MatchDetailScreen(
            match: PreviewData.matchDetail,
            gameDefinition: PreviewData.gameDefinition
        )

        #expect(screen.turns.map(\.number) == [1])
        #expect(screen.turns[0].teamTurns.map(\.teamId) == ["team-1", "team-2"])
        #expect(
            screen.turns[0].teamTurns[0].shots.map(\.playerId) == [
                "player-alex",
                "player-sam"
            ]
        )
        #expect(
            screen.turns[0].teamTurns[1].shots.map(\.playerId) == [
                "player-jordan",
                "player-casey"
            ]
        )
    }

    @Test func linksEachScorecardShotToItsRecordedPlay() {
        let turns = MatchTurnProjector.project(
            scorecard: PreviewData.matchDetail.scorecard,
            events: PreviewData.matchDetail.events
        )
        let shots = turns.flatMap(\.teamTurns).flatMap(\.shots)

        #expect(shots.map { $0.events.map(\.type) } == [
            ["di"],
            ["make"],
            ["guy"],
            ["miss"]
        ])
    }
}
