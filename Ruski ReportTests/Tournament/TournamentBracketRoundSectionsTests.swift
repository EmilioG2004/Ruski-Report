//
//  TournamentBracketRoundSectionsTests.swift
//  Ruski ReportTests
//

import Testing
@testable import Ruski_Report

struct TournamentBracketRoundSectionsTests {
    @Test func bracketRoundSectionsShowWinnersAndProgressionByRoundOrder() {
        let detail = TournamentDetail(
            id: "tournament-test",
            gameType: "ruski",
            preview: PreviewData.tournamentPreview,
            pods: [],
            teams: [
                TournamentTeam(id: "team-a", name: "Alpha", seed: 1, players: []),
                TournamentTeam(id: "team-b", name: "Bravo", seed: 4, players: []),
                TournamentTeam(id: "team-c", name: "Charlie", seed: 2, players: []),
                TournamentTeam(id: "team-d", name: "Delta", seed: 3, players: [])
            ],
            standings: [],
            bracket: TournamentBracket(
                id: "bracket-test",
                rounds: [
                    BracketRound(
                        id: "round-final",
                        name: "Final",
                        sequence: 2,
                        matchIds: ["match-final"],
                        matches: []
                    ),
                    BracketRound(
                        id: "round-semi",
                        name: "Semifinals",
                        sequence: 1,
                        matchIds: ["match-semi"],
                        matches: []
                    )
                ]
            ),
            matches: [
                bracketMatch(
                    id: "match-semi",
                    status: .final,
                    teamIds: ["team-a", "team-b"],
                    scores: [10, 7],
                    winnerTeamId: "team-a"
                ),
                bracketMatch(
                    id: "match-final",
                    status: .final,
                    teamIds: ["team-a", "team-c"],
                    scores: [10, 8],
                    winnerTeamId: "team-a"
                )
            ],
            statistics: []
        )

        let sections = detail.bracketRoundSections()

        #expect(sections.map(\.name) == ["Semifinals", "Final"])
        #expect(sections.first?.matchups.first?.title == "Alpha vs Bravo")
        #expect(sections.first?.matchups.first?.progressionText == "Winner advances to Final")
        #expect(sections.first?.matchups.first?.slots.first?.isWinner == true)
        #expect(sections.first?.matchups.first?.slots.first?.score == 10)
        #expect(sections.first?.matchups.first?.isScoreUnavailable == false)
        #expect(sections.last?.matchups.first?.progressionText == "Bracket winner")
    }

    @Test func bracketRoundSectionsKeepMissingMatchesVisible() {
        let detail = TournamentDetail(
            id: "tournament-test",
            gameType: "ruski",
            preview: PreviewData.tournamentPreview,
            pods: [],
            teams: [],
            standings: [],
            bracket: TournamentBracket(
                id: "bracket-test",
                rounds: [
                    BracketRound(
                        id: "round-1",
                        name: "Round 1",
                        sequence: 1,
                        matchIds: ["missing-match"],
                        matches: []
                    )
                ]
            ),
            matches: [],
            statistics: []
        )

        let matchup = detail.bracketRoundSections().first?.matchups.first

        #expect(matchup?.id == "missing-match")
        #expect(matchup?.title == "Match 1")
        #expect(matchup?.statusText == "Pending")
        #expect(matchup?.isAvailable == false)
        #expect(matchup?.isScoreUnavailable == true)
        #expect(matchup?.slots.isEmpty == true)
    }

    @Test func bracketRoundSectionsRenderPendingTopologyWithoutMatchDetails() {
        let detail = TournamentDetail(
            id: "tournament-test",
            gameType: "ruski",
            preview: PreviewData.tournamentPreview,
            pods: [],
            teams: [
                TournamentTeam(id: "team-a", name: "Alpha", seed: 1, players: []),
                TournamentTeam(id: "team-b", name: "Bravo", seed: 16, players: [])
            ],
            standings: [],
            bracket: TournamentBracket(
                id: "bracket-test",
                rounds: [
                    BracketRound(
                        id: "round-1",
                        name: "Sweet 16",
                        sequence: 1,
                        matchIds: [],
                        matches: [
                            TournamentBracketMatch(
                                id: "sweet-16-1",
                                matchId: nil,
                                sequence: 1,
                                status: "completed",
                                slots: [
                                    TournamentBracketSlot(
                                        seed: 1,
                                        teamId: "team-a",
                                        source: TournamentBracketSlotSource(
                                            type: "team",
                                            sourceMatchId: nil,
                                            label: nil
                                        )
                                    ),
                                    TournamentBracketSlot(
                                        seed: 16,
                                        teamId: "team-b",
                                        source: TournamentBracketSlotSource(
                                            type: "team",
                                            sourceMatchId: nil,
                                            label: nil
                                        )
                                    )
                                ],
                                winnerTeamId: "team-a"
                            )
                        ]
                    ),
                    BracketRound(
                        id: "round-2",
                        name: "Elite 8",
                        sequence: 2,
                        matchIds: [],
                        matches: [
                            TournamentBracketMatch(
                                id: "elite-8-1",
                                matchId: nil,
                                sequence: 1,
                                status: "pending",
                                slots: [
                                    TournamentBracketSlot(
                                        seed: nil,
                                        teamId: "team-a",
                                        source: TournamentBracketSlotSource(
                                            type: "match-winner",
                                            sourceMatchId: "sweet-16-1",
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
            matches: [],
            statistics: []
        )

        let matchup = detail.bracketRoundSections().first?.matchups.first

        #expect(matchup?.title == "Alpha vs Bravo")
        #expect(matchup?.statusText == "Completed")
        #expect(matchup?.slots.first?.isWinner == true)
        #expect(matchup?.progressionText == "Winner advances to Elite 8")
        #expect(matchup?.isAvailable == false)
    }

    private func bracketMatch(
        id: String,
        status: MatchStatus,
        teamIds: [String],
        scores: [Int],
        winnerTeamId: String?
    ) -> MatchPreview {
        MatchPreview(
            id: id,
            tournamentId: "tournament-test",
            gameType: "ruski",
            status: status,
            participants: teamIds.enumerated().map { index, teamId in
                MatchParticipant(
                    teamId: teamId,
                    role: nil,
                    seed: index + 1,
                    playerIds: [],
                    score: scores[index],
                    result: teamId == winnerTeamId ? "win" : "loss"
                )
            },
            score: MatchScore(
                participants: teamIds.enumerated().map { index, teamId in
                    TeamScore(teamId: teamId, score: scores[index])
                },
                winnerTeamId: winnerTeamId,
                isFinal: status == .final
            ),
            podId: nil,
            currentPhaseLabel: nil,
            updatedAt: "2026-06-21T00:00:00.000Z"
        )
    }
}
