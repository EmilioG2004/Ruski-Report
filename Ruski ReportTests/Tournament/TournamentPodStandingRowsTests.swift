//
//  TournamentPodStandingRowsTests.swift
//  Ruski ReportTests
//

import Testing
@testable import Ruski_Report

struct TournamentPodStandingRowsTests {
    @Test func podStandingRowsIncludeEveryPodTeamOrderedByRank() {
        let pod = TournamentPod(
            id: "pod-test",
            name: "Pod Test",
            sequence: 1,
            teamIds: ["team-b", "team-a", "team-c", "team-d"],
            matchIds: []
        )
        let detail = TournamentDetail(
            id: "tournament-test",
            gameType: "ruski",
            preview: PreviewData.tournamentPreview,
            pods: [pod],
            teams: [
                TournamentTeam(id: "team-a", name: "Alpha", seed: 1, players: []),
                TournamentTeam(id: "team-b", name: "Bravo", seed: 2, players: []),
                TournamentTeam(id: "team-c", name: "Charlie", seed: 3, players: []),
                TournamentTeam(id: "team-d", name: "Delta", seed: 4, players: [])
            ],
            standings: [
                PodStanding(
                    id: "standing-c",
                    podId: "pod-test",
                    teamId: "team-c",
                    rank: 1,
                    wins: 2,
                    losses: 0,
                    points: 4,
                    cupDifferential: 5,
                    shootingPercentage: 0.62
                ),
                PodStanding(
                    id: "standing-a",
                    podId: "pod-test",
                    teamId: "team-a",
                    rank: 2,
                    wins: 1,
                    losses: 1,
                    points: 2,
                    cupDifferential: 1,
                    shootingPercentage: 0.5
                )
            ],
            bracket: nil,
            matches: [],
            statistics: []
        )

        let rows = detail.podStandingRows(for: pod)

        #expect(rows.map(\.teamId) == ["team-c", "team-a", "team-b", "team-d"])
        #expect(rows.count == 4)
        #expect(rows.first?.teamName == "Charlie")
        #expect(rows.first?.wins == 2)
        #expect(rows.first?.shootingPercentage == 0.62)
    }

    @Test func podStandingRowsKeepUnrankedTeamsWithAvailableSeedOnly() {
        let pod = TournamentPod(
            id: "pod-test",
            name: "Pod Test",
            sequence: 1,
            teamIds: ["team-a", "team-b"],
            matchIds: []
        )
        let detail = TournamentDetail(
            id: "tournament-test",
            gameType: "ruski",
            preview: PreviewData.tournamentPreview,
            pods: [pod],
            teams: [
                TournamentTeam(id: "team-a", name: "Alpha", seed: 1, players: []),
                TournamentTeam(id: "team-b", name: "Bravo", seed: 2, players: [])
            ],
            standings: [],
            bracket: nil,
            matches: [],
            statistics: []
        )

        let rows = detail.podStandingRows(for: pod)

        #expect(rows.map(\.teamId) == ["team-a", "team-b"])
        #expect(rows.map(\.seed) == [1, 2])
        #expect(rows.allSatisfy { $0.rank == nil })
        #expect(rows.allSatisfy { $0.wins == nil && $0.losses == nil })
        #expect(rows.allSatisfy { $0.cupDifferential == nil })
        #expect(rows.allSatisfy { $0.shootingPercentage == nil })
    }
}
