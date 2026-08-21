//
//  PublicRepositoryDTOFixtures.swift
//  Ruski ReportTests
//

@testable import Ruski_Report

let publicTournamentId = "tournament-public-2027"
let publicProjectionVersion: Int64 = 7

func publicProjectionDTO(
    tournamentId: String = publicTournamentId,
    version: Int64 = publicProjectionVersion
) -> PublicProjectionDTO {
    PublicProjectionDTO(
        tournamentId: tournamentId,
        version: version,
        activatedAt: "2027-06-21T18:00:00.000Z",
        source: "canonical"
    )
}

func publicTournamentSummaryDTO(
    id: String = publicTournamentId,
    name: String = "The Extremely Long Durham Ruski Invitational Name"
) -> PublicTournamentSummaryDTO {
    PublicTournamentSummaryDTO(
        id: id,
        gameType: "ruski",
        year: 2027,
        name: name,
        lifecycle: "playoffs"
    )
}

func publicParticipantDTO(
    side: Int,
    score: Int? = nil,
    result: String? = nil,
    historical: Bool = false
) -> PublicMatchParticipantDTO {
    let first = side == 1
    return PublicMatchParticipantDTO(
        side: side,
        role: first ? "home" : "away",
        team: PublicTeamIdentityDTO(
            id: first ? "team-alpha" : "team-beta",
            name: first
                ? "Alpha Team With A Very Long Display Name"
                : "Beta Team"
        ),
        players: [
            PublicPlayerDTO(
                id: historical && first ? "player-alpha-original" :
                    (first ? "player-alpha-current" : "player-beta"),
                displayName: historical && first ? "Original Alpha Player" :
                    (first ? "Replacement Alpha Player" : "Beta Player"),
                rosterSlot: 1
            )
        ],
        seed: first ? 1 : 2,
        score: score,
        result: result
    )
}

func publicMatchSummaryDTO(
    id: String = "match-pod-1",
    stage: String = "pod_play",
    status: String = "final",
    scoreAvailability: String = "complete"
) -> PublicMatchSummaryDTO {
    let state = publicMatchState(status: status, availability: scoreAvailability)
    return PublicMatchSummaryDTO(
        id: id,
        stage: stage,
        sequence: 1,
        podId: stage == "pod_play" ? "pod-a" : nil,
        bracketMatchId: stage == "playoffs" ? "bracket-node-live" : nil,
        instance: 1,
        revision: status == "scheduled" ? nil : 1,
        status: status,
        scoreAvailability: scoreAvailability,
        correction: PublicMatchCorrectionDTO(
            isCorrection: false,
            reason: nil,
            previousRevision: nil,
            replacesMatchId: nil,
            replacedByMatchId: nil
        ),
        timestamps: PublicMatchTimestampsDTO(
            scheduledAt: status == "scheduled" ? nil : "2027-06-21T16:00:00.000Z",
            startedAt: status == "scheduled" || status == "postponed"
                ? nil
                : "2027-06-21T16:05:00.000Z",
            endedAt: ["final", "forfeited", "cancelled"].contains(status)
                ? "2027-06-21T16:45:00.000Z"
                : nil,
            updatedAt: "2027-06-21T16:45:00.000Z"
        ),
        participants: [
            publicParticipantDTO(
                side: 1,
                score: state.scores?.0,
                result: state.results?.0,
                historical: true
            ),
            publicParticipantDTO(
                side: 2,
                score: state.scores?.1,
                result: state.results?.1
            )
        ],
        winner: state.winner
    )
}

func publicMatchDTO() -> PublicMatchDTO {
    let summary = publicMatchSummaryDTO()
    return PublicMatchDTO(
        id: summary.id,
        stage: summary.stage,
        sequence: summary.sequence,
        podId: summary.podId,
        bracketMatchId: summary.bracketMatchId,
        instance: summary.instance,
        revision: summary.revision,
        status: summary.status,
        scoreAvailability: summary.scoreAvailability,
        correction: summary.correction,
        timestamps: summary.timestamps,
        participants: summary.participants,
        winner: summary.winner,
        events: [
            PublicMatchEventDTO(
                id: "event-1",
                sequence: 1,
                type: "attempt",
                teamId: "team-alpha",
                playerId: "player-alpha-original",
                occurredAt: "2027-06-21T16:06:00.000Z",
                details: ["make": .bool(true)]
            )
        ],
        statistics: [
            PublicStatisticDTO(
                scope: "match",
                scopeId: summary.id,
                stage: "pod_play",
                subject: PublicStatisticSubjectDTO(
                    id: "team-alpha",
                    name: "Alpha Team With A Very Long Display Name",
                    displayName: nil
                ),
                values: ["makes": 10, "shootingPercentage": 0.5]
            )
        ],
        boxScore: PublicBoxScoreDTO(
            columns: [
                PublicBoxScoreColumnDTO(key: "makes", label: "Makes", format: "integer")
            ],
            rows: [
                PublicBoxScoreRowDTO(
                    id: "box-player-alpha",
                    subject: PublicBoxScoreSubjectDTO(
                        id: "player-alpha-original",
                        displayName: "Original Alpha Player",
                        type: "player"
                    ),
                    teamId: "team-alpha",
                    values: ["makes": 10]
                )
            ],
            totals: ["makes": 18]
        ),
        scorecard: PublicScorecardDTO(
            columns: [
                PublicScorecardColumnDTO(key: "make", label: "Make", kind: "marker")
            ],
            rows: [
                PublicScorecardRowDTO(
                    id: "scorecard-row-1",
                    sequence: 1,
                    side: 1,
                    teamId: "team-alpha",
                    playerId: "player-alpha-original",
                    playerDisplayName: "Original Alpha Player",
                    values: ["make": .bool(true)]
                )
            ]
        )
    )
}

func publicTournamentDTO() -> PublicTournamentDTO {
    let alpha = PublicTeamIdentityDTO(
        id: "team-alpha",
        name: "Alpha Team With A Very Long Display Name"
    )
    let beta = PublicTeamIdentityDTO(id: "team-beta", name: "Beta Team")
    return PublicTournamentDTO(
        id: publicTournamentId,
        gameType: "ruski",
        year: 2027,
        name: "The Extremely Long Durham Ruski Invitational Name",
        lifecycle: "playoffs",
        format: PublicTournamentFormatDTO(
            formatVersion: 1,
            formatType: "pod_and_single_elimination",
            teamCount: 2,
            podCount: 1,
            podSizes: [2],
            playersPerTeam: 1,
            gamesPerPair: 1,
            qualifiersPerPod: 1,
            bracketSize: 4,
            allowByes: true,
            standingsRules: [
                "record",
                "cupDifferential",
                "teamShootingPercentage",
                "administratorResolution"
            ],
            copiedFromPresetId: nil
        ),
        rosters: [
            PublicRosterTeamDTO(
                id: alpha.id,
                name: alpha.name,
                podId: "pod-a",
                initialPodSeed: 1,
                players: [
                    PublicPlayerDTO(
                        id: "player-alpha-current",
                        displayName: "Replacement Alpha Player",
                        rosterSlot: 1
                    )
                ]
            ),
            PublicRosterTeamDTO(
                id: beta.id,
                name: beta.name,
                podId: "pod-a",
                initialPodSeed: 2,
                players: [
                    PublicPlayerDTO(
                        id: "player-beta",
                        displayName: "Beta Player",
                        rosterSlot: 1
                    )
                ]
            )
        ],
        pods: [
            PublicPodDTO(
                id: "pod-a",
                name: "Pod A",
                sequence: 1,
                standingState: "unresolved_tie",
                finalizedAt: nil,
                standings: [
                    publicStandingDTO(team: alpha),
                    publicStandingDTO(team: beta)
                ]
            )
        ],
        seeds: [
            PublicSeedDTO(
                team: alpha,
                calculatedSeed: 1,
                effectiveSeed: 1,
                overridden: false
            ),
            PublicSeedDTO(
                team: beta,
                calculatedSeed: nil,
                effectiveSeed: nil,
                overridden: false
            )
        ],
        statistics: [
            PublicStatisticDTO(
                scope: "player",
                scopeId: "player-alpha-original",
                stage: "pod_play",
                subject: PublicStatisticSubjectDTO(
                    id: "player-alpha-original",
                    name: nil,
                    displayName: "Original Alpha Player"
                ),
                values: ["makes": 10]
            )
        ],
        matches: [publicMatchSummaryDTO()],
        bracket: publicBracketDTO(alpha: alpha)
    )
}

func publicStandingDTO(team: PublicTeamIdentityDTO) -> PublicStandingDTO {
    PublicStandingDTO(
        team: team,
        rank: nil,
        wins: 1,
        losses: 1,
        cupDifferential: 0,
        makes: 10,
        attempts: 20,
        shootingPercentage: 0.5,
        tieGroup: "tie-a",
        administratorResolved: false
    )
}

func publicBracketDTO(alpha: PublicTeamIdentityDTO) -> PublicBracketDTO {
    PublicBracketDTO(
        id: "bracket-1",
        name: "Championship",
        size: 4,
        rounds: [
            PublicBracketRoundDTO(
                id: "round-1",
                name: "Semifinals",
                sequence: 1,
                matches: [
                    PublicBracketMatchDTO(
                        id: "bracket-node-1",
                        round: 1,
                        position: 1,
                        status: "bye",
                        matchId: nil,
                        replacedMatchId: nil,
                        slots: [
                            PublicBracketSlotDTO(
                                source: "team",
                                sourceBracketMatchId: nil,
                                team: alpha,
                                seed: 1
                            ),
                            PublicBracketSlotDTO(
                                source: "bye",
                                sourceBracketMatchId: nil,
                                team: nil,
                                seed: nil
                            )
                        ],
                        winner: alpha
                    ),
                    PublicBracketMatchDTO(
                        id: "bracket-node-2",
                        round: 1,
                        position: 2,
                        status: "pending",
                        matchId: nil,
                        replacedMatchId: nil,
                        slots: [
                            PublicBracketSlotDTO(
                                source: "tbd",
                                sourceBracketMatchId: nil,
                                team: nil,
                                seed: nil
                            ),
                            PublicBracketSlotDTO(
                                source: "tbd",
                                sourceBracketMatchId: nil,
                                team: nil,
                                seed: nil
                            )
                        ],
                        winner: nil
                    )
                ]
            ),
            PublicBracketRoundDTO(
                id: "round-2",
                name: "Championship",
                sequence: 2,
                matches: [
                    PublicBracketMatchDTO(
                        id: "bracket-node-3",
                        round: 2,
                        position: 1,
                        status: "corrected",
                        matchId: nil,
                        replacedMatchId: "match-replaced-after-correction",
                        slots: [
                            PublicBracketSlotDTO(
                                source: "match_winner",
                                sourceBracketMatchId: "bracket-node-1",
                                team: alpha,
                                seed: 1
                            ),
                            PublicBracketSlotDTO(
                                source: "match_winner",
                                sourceBracketMatchId: "bracket-node-2",
                                team: nil,
                                seed: nil
                            )
                        ],
                        winner: nil
                    )
                ]
            )
        ]
    )
}

func publicMatchState(
    status: String,
    availability: String
) -> (
    scores: (Int, Int)?,
    results: (String, String)?,
    winner: PublicTeamIdentityDTO?
) {
    let alpha = PublicTeamIdentityDTO(
        id: "team-alpha",
        name: "Alpha Team With A Very Long Display Name"
    )
    switch (status, availability) {
    case ("in_progress", "partial"):
        return ((4, 3), nil, nil)
    case ("final", "complete"):
        return ((10, 8), ("win", "loss"), alpha)
    case ("final", "unrecorded"):
        return (nil, ("win", "loss"), alpha)
    case ("forfeited", "not_applicable"):
        return (nil, ("win", "forfeited"), alpha)
    case ("cancelled", "not_applicable"):
        return (nil, ("cancelled", "cancelled"), nil)
    default:
        return (nil, nil, nil)
    }
}
