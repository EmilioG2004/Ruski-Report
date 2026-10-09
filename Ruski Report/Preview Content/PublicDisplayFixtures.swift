//
//  PublicDisplayFixtures.swift
//  Ruski Report
//
//  Sanitized, deterministic canonical projection fixtures for previews and UI
//  qualification. These values never contact a live service.
//

import Foundation

nonisolated enum PublicDisplayFixtures {
    static let primaryTournamentId = "summer-classic-2027"
    static let secondaryTournamentId = "fall-invitational-2027"
    static let completedTournamentId = "legacy-championship-2026"
    static let archivedTournamentId = "archive-invitational-2025"

    static let primaryProjection = PublicProjectionReference(
        tournamentId: primaryTournamentId,
        version: 8,
        activatedAt: "2027-06-01T18:30:00.000Z"
    )

    static let secondaryProjection = PublicProjectionReference(
        tournamentId: secondaryTournamentId,
        version: 3,
        activatedAt: "2027-05-28T14:00:00.000Z"
    )

    static let completedProjection = PublicProjectionReference(
        tournamentId: completedTournamentId,
        version: 12,
        activatedAt: "2026-07-12T22:00:00.000Z"
    )

    static let archivedProjection = PublicProjectionReference(
        tournamentId: archivedTournamentId,
        version: 4,
        activatedAt: "2025-07-13T22:00:00.000Z"
    )

    static let redTeam = PublicTeamIdentity(id: "team-red", name: "Red Rockets")
    static let blueTeam = PublicTeamIdentity(id: "team-blue", name: "Blue Barracudas")
    static let greenTeam = PublicTeamIdentity(id: "team-green", name: "Green Giants")
    static let goldTeam = PublicTeamIdentity(id: "team-gold", name: "Gold Guardians")

    static let currentRedPlayers = [
        PublicPlayer(id: "red-replacement", displayName: "Riley Replacement", rosterSlot: 1),
        PublicPlayer(id: "red-current", displayName: "Casey Current", rosterSlot: 2)
    ]

    static let historicalRedPlayers = [
        PublicPlayer(id: "red-original", displayName: "Alex Original", rosterSlot: 1),
        PublicPlayer(id: "red-current", displayName: "Casey Current", rosterSlot: 2)
    ]

    static let bluePlayers = [
        PublicPlayer(id: "blue-one", displayName: "Bailey Blue", rosterSlot: 1),
        PublicPlayer(id: "blue-two", displayName: "Brennan Blue", rosterSlot: 2)
    ]

    static let greenPlayers = [
        PublicPlayer(id: "green-one", displayName: "Gray Green", rosterSlot: 1),
        PublicPlayer(id: "green-two", displayName: "Gale Green", rosterSlot: 2)
    ]

    static let goldPlayers = [
        PublicPlayer(id: "gold-one", displayName: "Gwen Gold", rosterSlot: 1),
        PublicPlayer(id: "gold-two", displayName: "Gus Gold", rosterSlot: 2)
    ]

    static let matches: [PublicMatchSummary] = [
        match(
            id: "public-scheduled-unknown",
            instance: 1,
            status: .scheduled,
            availability: .notStarted
        ),
        match(
            id: "public-scheduled-known",
            instance: 2,
            status: .scheduled,
            availability: .notStarted,
            scheduledAt: "2027-06-02T19:30:00.000Z"
        ),
        match(
            id: "public-live-partial",
            instance: 3,
            status: .inProgress,
            availability: .partial,
            redScore: 3,
            blueScore: 2,
            startedAt: "2027-06-01T18:00:00.000Z"
        ),
        match(
            id: "public-final-complete",
            instance: 4,
            status: .final,
            availability: .complete,
            redScore: 6,
            blueScore: 4,
            winner: redTeam,
            redResult: .win,
            blueResult: .loss,
            startedAt: "2027-05-31T18:00:00.000Z",
            endedAt: "2027-05-31T18:22:00.000Z"
        ),
        match(
            id: "public-final-unrecorded",
            instance: 5,
            status: .final,
            availability: .unrecorded,
            winner: blueTeam,
            redResult: .loss,
            blueResult: .win,
            endedAt: "2027-05-31T20:00:00.000Z"
        ),
        match(
            id: "public-forfeited",
            instance: 6,
            status: .forfeited,
            availability: .notApplicable,
            winner: redTeam,
            redResult: .win,
            blueResult: .forfeited,
            endedAt: "2027-05-31T21:00:00.000Z"
        ),
        match(
            id: "public-cancelled",
            instance: 7,
            status: .cancelled,
            availability: .notApplicable,
            redResult: .cancelled,
            blueResult: .cancelled,
            endedAt: "2027-05-31T22:00:00.000Z"
        ),
        match(
            id: "public-postponed",
            instance: 8,
            status: .postponed,
            availability: .notStarted,
            scheduledAt: "2027-06-03T18:00:00.000Z"
        ),
        match(
            id: "public-playoff-rematch",
            instance: 9,
            stage: .playoffs,
            status: .final,
            availability: .complete,
            redScore: 6,
            blueScore: 5,
            winner: redTeam,
            redResult: .win,
            blueResult: .loss,
            bracketMatchId: "bracket-completed",
            correction: PublicMatchCorrection(
                isCorrection: true,
                reason: "Corrected from the audited final scorecard.",
                previousRevision: 1,
                replacesMatchId: "public-playoff-rematch-original",
                replacedByMatchId: nil
            ),
            startedAt: "2027-06-04T18:00:00.000Z",
            endedAt: "2027-06-04T18:25:00.000Z"
        )
    ]

    static let matchDetailsById: [String: PublicMatchDetail] = Dictionary(
        uniqueKeysWithValues: (matches + longMatches + secondaryMatches).map { summary in
            let detailed = summary.id == "public-final-complete" ||
                summary.id == "public-playoff-rematch"
            return (
                summary.id,
                PublicMatchDetail(
                    id: summary.id,
                    summary: summary,
                    events: detailed ? sampleEvents : [],
                    statistics: detailed ? sampleMatchStatistics : [],
                    boxScore: detailed ? sampleBoxScore : nil,
                    scorecard: detailed ? sampleScorecard : nil
                )
            )
        }
    )

    static let tournamentDetail = PublicTournamentDetail(
        id: primaryTournamentId,
        gameType: "ruski",
        year: 2027,
        name: "Summer Classic",
        lifecycle: .playoffs,
        projection: primaryProjection,
        format: format,
        rosters: rosters,
        pods: pods,
        seeds: seeds,
        statistics: tournamentStatistics,
        matches: matches,
        bracket: bracket
    )

    static let emptyBracketTournamentDetail = PublicTournamentDetail(
        id: primaryTournamentId,
        gameType: "ruski",
        year: 2027,
        name: "Summer Classic",
        lifecycle: .seedingReview,
        projection: primaryProjection,
        format: format,
        rosters: rosters,
        pods: pods,
        seeds: seeds,
        statistics: [],
        matches: matches,
        bracket: nil
    )

    static let longContentTournamentDetail = PublicTournamentDetail(
        id: primaryTournamentId,
        gameType: "ruski",
        year: 2027,
        name: "The North Durham Longtable Invitational Championship and Community Cup",
        lifecycle: .playoffs,
        projection: primaryProjection,
        format: format,
        rosters: longRosters,
        pods: longPods,
        seeds: seeds,
        statistics: tournamentStatistics,
        matches: longMatches,
        bracket: longBracket
    )

    static let secondaryTournamentDetail = PublicTournamentDetail(
        id: secondaryTournamentId,
        gameType: "ruski",
        year: 2027,
        name: "Fall Invitational",
        lifecycle: .podPlay,
        projection: secondaryProjection,
        format: format,
        rosters: rosters,
        pods: [pods[1]],
        seeds: [],
        statistics: [],
        matches: secondaryMatches,
        bracket: nil
    )

    static let completedTournamentDetail = historicalTournamentDetail(
        id: completedTournamentId,
        year: 2026,
        name: "2026 Championship",
        lifecycle: .completed,
        projection: completedProjection
    )

    static let archivedTournamentDetail = historicalTournamentDetail(
        id: archivedTournamentId,
        year: 2025,
        name: "2025 Invitational Archive",
        lifecycle: .archived,
        projection: archivedProjection
    )

    static let history = [
        completedTournamentDetail.summary,
        archivedTournamentDetail.summary
    ]

    static let historicalMatchDetails = [
        completedTournamentDetail,
        archivedTournamentDetail
    ].flatMap { tournament in
        tournament.matches.map { summary in
            PublicMatchDetail(
                id: summary.id,
                summary: summary,
                events: [],
                statistics: [],
                boxScore: nil,
                scorecard: nil
            )
        }
    }

    static let homeZero = PublicHomeScreen(
        tournaments: [],
        detailsByTournamentId: [:]
    )

    static let homeTwo = PublicHomeScreen(
        tournaments: [
            tournamentDetail.summary,
            secondaryTournamentDetail.summary
        ],
        detailsByTournamentId: [
            tournamentDetail.id: tournamentDetail,
            secondaryTournamentDetail.id: secondaryTournamentDetail
        ]
    )

    static let homePartialDetail = PublicHomeScreen(
        tournaments: [
            tournamentDetail.summary,
            secondaryTournamentDetail.summary
        ],
        detailsByTournamentId: [
            tournamentDetail.id: tournamentDetail
        ]
    )

    static let homeLongContent = PublicHomeScreen(
        tournaments: [longContentTournamentDetail.summary],
        detailsByTournamentId: [
            longContentTournamentDetail.id: longContentTournamentDetail
        ]
    )

    private static let format = PublicTournamentFormat(
        formatVersion: 1,
        teamCount: 4,
        podCount: 2,
        podSizes: [2, 2],
        playersPerTeam: 2,
        gamesPerPair: 1,
        qualifiersPerPod: 1,
        bracketSize: 4,
        allowByes: true,
        standingsRules: [
            .record,
            .cupDifferential,
            .teamShootingPercentage,
            .administratorResolution
        ],
        copiedFromPresetId: nil
    )

    private static let rosters = [
        PublicRosterTeam(
            id: redTeam.id,
            name: redTeam.name,
            podId: "pod-a",
            initialPodSeed: 1,
            players: currentRedPlayers
        ),
        PublicRosterTeam(
            id: blueTeam.id,
            name: blueTeam.name,
            podId: "pod-a",
            initialPodSeed: 2,
            players: bluePlayers
        ),
        PublicRosterTeam(
            id: greenTeam.id,
            name: greenTeam.name,
            podId: "pod-b",
            initialPodSeed: 1,
            players: greenPlayers
        ),
        PublicRosterTeam(
            id: goldTeam.id,
            name: goldTeam.name,
            podId: "pod-b",
            initialPodSeed: 2,
            players: goldPlayers
        )
    ]

    private static let pods = [
        PublicPod(
            id: "pod-zero",
            name: "Pod Zero",
            sequence: 1,
            standingState: .zeroGame,
            finalizedAt: nil,
            standings: [
                standing(team: redTeam, rank: nil, wins: 0, losses: 0),
                standing(team: blueTeam, rank: nil, wins: 0, losses: 0)
            ]
        ),
        PublicPod(
            id: "pod-active",
            name: "Pod Provisional",
            sequence: 2,
            standingState: .active,
            finalizedAt: nil,
            standings: [
                standing(team: redTeam, rank: 1, wins: 1, losses: 0, differential: 2),
                standing(team: blueTeam, rank: 2, wins: 0, losses: 1, differential: -2)
            ]
        ),
        PublicPod(
            id: "pod-finalized",
            name: "Pod Finalized",
            sequence: 3,
            standingState: .finalized,
            finalizedAt: "2027-06-01T12:00:00.000Z",
            standings: [
                standing(
                    team: greenTeam,
                    rank: 1,
                    wins: 1,
                    losses: 0,
                    differential: 1,
                    administratorResolved: true
                ),
                standing(team: goldTeam, rank: 2, wins: 0, losses: 1, differential: -1)
            ]
        ),
        PublicPod(
            id: "pod-tied",
            name: "Pod Unresolved",
            sequence: 4,
            standingState: .unresolvedTie,
            finalizedAt: nil,
            standings: [
                standing(team: redTeam, rank: nil, wins: 1, losses: 1, tieGroup: "tie-a"),
                standing(team: blueTeam, rank: nil, wins: 1, losses: 1, tieGroup: "tie-a")
            ]
        )
    ]

    private static let seeds = [
        PublicSeed(team: redTeam, calculatedSeed: 2, effectiveSeed: 1, overridden: true),
        PublicSeed(team: greenTeam, calculatedSeed: 1, effectiveSeed: 2, overridden: true)
    ]

    private static let tournamentStatistics = [
        PublicStatistic(
            scope: .team,
            scopeId: redTeam.id,
            stage: nil,
            subject: .team(redTeam),
            values: ["wins": 4, "shootingPercentage": 0.625]
        )
    ]

    private static let sampleMatchStatistics = [
        PublicStatistic(
            scope: .match,
            scopeId: "public-final-complete",
            stage: .podPlay,
            subject: .team(redTeam),
            values: ["makes": 6, "attempts": 10, "shootingPercentage": 0.6]
        )
    ]

    private static let sampleEvents = [
        PublicMatchEvent(
            id: "event-1",
            sequence: 1,
            type: "shot_attempt",
            teamId: redTeam.id,
            playerId: "red-original",
            occurredAt: "2027-05-31T18:01:00.000Z",
            details: ["make": .bool(true)]
        ),
        PublicMatchEvent(
            id: "event-2",
            sequence: 2,
            type: "shot_attempt",
            teamId: blueTeam.id,
            playerId: "blue-one",
            occurredAt: "2027-05-31T18:02:00.000Z",
            details: ["tri": .bool(true)]
        )
    ]

    private static let sampleBoxScore = PublicBoxScore(
        columns: [
            PublicBoxScoreColumn(key: "makes", label: "Makes", format: .integer),
            PublicBoxScoreColumn(
                key: "shootingPercentage",
                label: "Shooting",
                format: .percentage
            )
        ],
        rows: [
            PublicBoxScoreRow(
                id: "box-red-original",
                subjectId: "red-original",
                subjectDisplayName: "Alex Original",
                subjectType: .player,
                teamId: redTeam.id,
                values: ["makes": 3, "shootingPercentage": 0.6]
            ),
            PublicBoxScoreRow(
                id: "box-blue-one",
                subjectId: "blue-one",
                subjectDisplayName: "Bailey Blue",
                subjectType: .player,
                teamId: blueTeam.id,
                values: ["makes": 2, "shootingPercentage": 0.4]
            )
        ],
        totals: ["makes": 5]
    )

    private static let sampleScorecard = PublicScorecard(
        columns: [
            PublicScorecardColumn(key: "sequence", label: "Turn", kind: .sequence),
            PublicScorecardColumn(key: "make", label: "Make", kind: .marker),
            PublicScorecardColumn(key: "tri", label: "Tri", kind: .marker)
        ],
        rows: [
            PublicScorecardRow(
                id: "scorecard-1",
                sequence: 1,
                side: 1,
                teamId: redTeam.id,
                playerId: "red-original",
                playerDisplayName: "Alex Original",
                values: ["sequence": .number(1), "make": .bool(true), "tri": .bool(false)]
            ),
            PublicScorecardRow(
                id: "scorecard-2",
                sequence: 2,
                side: 2,
                teamId: blueTeam.id,
                playerId: "blue-one",
                playerDisplayName: "Bailey Blue",
                values: ["sequence": .number(2), "make": .bool(false), "tri": .bool(true)]
            )
        ]
    )

    private static let bracket = PublicBracket(
        id: "bracket-2027",
        name: "Championship Bracket",
        size: 8,
        rounds: [
            PublicBracketRound(
                id: "round-one",
                name: "Round One",
                sequence: 1,
                matches: [
                    PublicBracketMatch(
                        id: "bracket-automatic",
                        round: 1,
                        position: 1,
                        status: .bye,
                        matchId: nil,
                        replacedMatchId: nil,
                        slots: [.team(redTeam, seed: 1), .bye],
                        winner: redTeam
                    ),
                    PublicBracketMatch(
                        id: "bracket-blocked",
                        round: 1,
                        position: 2,
                        status: .pending,
                        matchId: nil,
                        replacedMatchId: nil,
                        slots: [.tbd, .team(goldTeam, seed: 8)],
                        winner: nil
                    ),
                    PublicBracketMatch(
                        id: "bracket-ready",
                        round: 1,
                        position: 3,
                        status: .pending,
                        matchId: "public-scheduled-known",
                        replacedMatchId: nil,
                        slots: [.team(greenTeam, seed: 3), .team(blueTeam, seed: 6)],
                        winner: nil
                    ),
                    PublicBracketMatch(
                        id: "bracket-live",
                        round: 1,
                        position: 4,
                        status: .inProgress,
                        matchId: "public-live-partial",
                        replacedMatchId: nil,
                        slots: [.team(redTeam, seed: 4), .team(blueTeam, seed: 5)],
                        winner: nil
                    )
                ]
            ),
            PublicBracketRound(
                id: "round-two",
                name: "Semifinal",
                sequence: 2,
                matches: [
                    PublicBracketMatch(
                        id: "bracket-waiting",
                        round: 2,
                        position: 1,
                        status: .pending,
                        matchId: nil,
                        replacedMatchId: nil,
                        slots: [
                            .matchWinner(
                                sourceBracketMatchId: "bracket-blocked",
                                team: nil,
                                seed: nil
                            ),
                            .team(redTeam, seed: 1)
                        ],
                        winner: nil
                    ),
                    PublicBracketMatch(
                        id: "bracket-completed",
                        round: 2,
                        position: 2,
                        status: .corrected,
                        matchId: "public-playoff-rematch",
                        replacedMatchId: "public-playoff-rematch-original",
                        slots: [.team(redTeam, seed: 4), .team(blueTeam, seed: 5)],
                        winner: redTeam
                    )
                ]
            )
        ]
    )

    private static let longRedTeam = PublicTeamIdentity(
        id: redTeam.id,
        name: "North Durham Longtable Society of Extremely Confident Shooters"
    )

    private static let longBlueTeam = PublicTeamIdentity(
        id: blueTeam.id,
        name: "South Shore Barracudas and Friends Annual Alumni Collective"
    )

    private static let longRosters = [
        PublicRosterTeam(
            id: longRedTeam.id,
            name: longRedTeam.name,
            podId: "pod-long",
            initialPodSeed: 1,
            players: [
                PublicPlayer(
                    id: "long-player-one",
                    displayName: "Alexandria Very-Long-Hyphenated Original Participant",
                    rosterSlot: 1
                ),
                PublicPlayer(
                    id: "long-player-two",
                    displayName: "Christopher Current Replacement Participant",
                    rosterSlot: 2
                )
            ]
        ),
        PublicRosterTeam(
            id: longBlueTeam.id,
            name: longBlueTeam.name,
            podId: "pod-long",
            initialPodSeed: 2,
            players: bluePlayers
        )
    ]

    private static let longPods = [
        PublicPod(
            id: "pod-long",
            name: "The Extremely Long and Descriptive Exhibition Pod",
            sequence: 1,
            standingState: .unresolvedTie,
            finalizedAt: nil,
            standings: [
                standing(team: longRedTeam, rank: nil, wins: 1, losses: 1, tieGroup: "long-tie"),
                standing(team: longBlueTeam, rank: nil, wins: 1, losses: 1, tieGroup: "long-tie")
            ]
        )
    ]

    private static let longMatches = [
        match(
            id: "public-long-match",
            instance: 1,
            stage: .playoffs,
            status: .inProgress,
            availability: .partial,
            redTeam: longRedTeam,
            blueTeam: longBlueTeam,
            redPlayers: longRosters[0].players,
            bluePlayers: longRosters[1].players,
            redScore: 5,
            blueScore: 5,
            bracketMatchId: "bracket-long",
            startedAt: "2027-06-05T18:00:00.000Z"
        )
    ]

    private static let secondaryMatches = [
        match(
            id: "fall-scheduled-unknown",
            instance: 1,
            status: .scheduled,
            availability: .notStarted,
            tournamentId: secondaryTournamentId,
            projection: secondaryProjection
        ),
        match(
            id: "fall-live-partial",
            instance: 2,
            status: .inProgress,
            availability: .partial,
            tournamentId: secondaryTournamentId,
            projection: secondaryProjection,
            redScore: 2,
            blueScore: 1,
            startedAt: "2027-06-01T19:00:00.000Z"
        )
    ]

    private static let longBracket = PublicBracket(
        id: "bracket-long-content",
        name: "The Championship Bracket with Particularly Long Participant Names",
        size: 2,
        rounds: [
            PublicBracketRound(
                id: "round-long",
                name: "Championship Final",
                sequence: 1,
                matches: [
                    PublicBracketMatch(
                        id: "bracket-long",
                        round: 1,
                        position: 1,
                        status: .inProgress,
                        matchId: "public-long-match",
                        replacedMatchId: nil,
                        slots: [
                            .team(longRedTeam, seed: 1),
                            .team(longBlueTeam, seed: 2)
                        ],
                        winner: nil
                    )
                ]
            )
        ]
    )

    private static func match(
        id: String,
        instance: Int,
        stage: PublicMatchStage = .podPlay,
        status: PublicMatchStatus,
        availability: PublicScoreAvailability,
        tournamentId: String = PublicDisplayFixtures.primaryTournamentId,
        projection: PublicProjectionReference = PublicDisplayFixtures.primaryProjection,
        redTeam: PublicTeamIdentity = PublicDisplayFixtures.redTeam,
        blueTeam: PublicTeamIdentity = PublicDisplayFixtures.blueTeam,
        redPlayers: [PublicPlayer] = PublicDisplayFixtures.historicalRedPlayers,
        bluePlayers: [PublicPlayer] = PublicDisplayFixtures.bluePlayers,
        redScore: Int? = nil,
        blueScore: Int? = nil,
        winner: PublicTeamIdentity? = nil,
        redResult: PublicParticipantResult? = nil,
        blueResult: PublicParticipantResult? = nil,
        bracketMatchId: String? = nil,
        correction: PublicMatchCorrection = PublicMatchCorrection(
            isCorrection: false,
            reason: nil,
            previousRevision: nil,
            replacesMatchId: nil,
            replacedByMatchId: nil
        ),
        scheduledAt: String? = nil,
        startedAt: String? = nil,
        endedAt: String? = nil
    ) -> PublicMatchSummary {
        PublicMatchSummary(
            id: id,
            tournamentId: tournamentId,
            projection: projection,
            stage: stage,
            sequence: instance,
            podId: stage == .podPlay ? "pod-active" : nil,
            bracketMatchId: bracketMatchId,
            instance: instance,
            revision: status == .scheduled || status == .postponed ? nil : 1,
            status: status,
            scoreAvailability: availability,
            correction: correction,
            timestamps: PublicMatchTimestamps(
                scheduledAt: scheduledAt,
                startedAt: startedAt,
                endedAt: endedAt,
                updatedAt: "2027-06-01T18:30:00.000Z"
            ),
            participants: [
                PublicMatchParticipant(
                    side: 1,
                    role: .home,
                    team: redTeam,
                    players: redPlayers,
                    seed: 1,
                    score: redScore,
                    result: redResult
                ),
                PublicMatchParticipant(
                    side: 2,
                    role: .away,
                    team: blueTeam,
                    players: bluePlayers,
                    seed: 2,
                    score: blueScore,
                    result: blueResult
                )
            ],
            winner: winner
        )
    }

    private static func historicalTournamentDetail(
        id: String,
        year: Int,
        name: String,
        lifecycle: PublicTournamentLifecycle,
        projection: PublicProjectionReference
    ) -> PublicTournamentDetail {
        func historicalId(_ sourceId: String) -> String {
            "\(id)-\(sourceId)"
        }
        let projectedMatches = matches.map { source in
            PublicMatchSummary(
                id: historicalId(source.id),
                tournamentId: id,
                projection: projection,
                stage: source.stage,
                sequence: source.sequence,
                podId: source.podId,
                bracketMatchId: source.bracketMatchId.map(historicalId),
                instance: source.instance,
                revision: source.revision,
                status: source.status,
                scoreAvailability: source.scoreAvailability,
                correction: PublicMatchCorrection(
                    isCorrection: source.correction.isCorrection,
                    reason: source.correction.reason,
                    previousRevision: source.correction.previousRevision,
                    replacesMatchId: source.correction.replacesMatchId.map(historicalId),
                    replacedByMatchId: source.correction.replacedByMatchId.map(
                        historicalId
                    )
                ),
                timestamps: source.timestamps,
                participants: source.participants,
                winner: source.winner
            )
        }
        let projectedBracket = PublicBracket(
            id: historicalId(bracket.id),
            name: bracket.name,
            size: bracket.size,
            rounds: bracket.rounds.map { round in
                PublicBracketRound(
                    id: historicalId(round.id),
                    name: round.name,
                    sequence: round.sequence,
                    matches: round.matches.map { match in
                        PublicBracketMatch(
                            id: historicalId(match.id),
                            round: match.round,
                            position: match.position,
                            status: match.status,
                            matchId: match.matchId.map(historicalId),
                            replacedMatchId: match.replacedMatchId.map(historicalId),
                            slots: match.slots.map { slot in
                                switch slot {
                                case .team, .bye, .tbd:
                                    slot
                                case .matchWinner(let sourceId, let team, let seed):
                                    .matchWinner(
                                        sourceBracketMatchId: historicalId(sourceId),
                                        team: team,
                                        seed: seed
                                    )
                                }
                            },
                            winner: match.winner
                        )
                    }
                )
            }
        )
        return PublicTournamentDetail(
            id: id,
            gameType: "ruski",
            year: year,
            name: name,
            lifecycle: lifecycle,
            projection: projection,
            format: format,
            rosters: rosters,
            pods: pods,
            seeds: seeds,
            statistics: tournamentStatistics,
            matches: projectedMatches,
            bracket: projectedBracket
        )
    }

    private static func standing(
        team: PublicTeamIdentity,
        rank: Int?,
        wins: Int,
        losses: Int,
        differential: Int = 0,
        tieGroup: String? = nil,
        administratorResolved: Bool = false
    ) -> PublicStanding {
        PublicStanding(
            team: team,
            rank: rank,
            wins: wins,
            losses: losses,
            cupDifferential: differential,
            makes: wins * 6,
            attempts: max(1, wins + losses) * 10,
            shootingPercentage: wins + losses == 0 ? nil : 0.5,
            tieGroup: tieGroup,
            administratorResolved: administratorResolved
        )
    }
}
