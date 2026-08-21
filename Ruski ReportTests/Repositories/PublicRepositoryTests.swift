//
//  PublicRepositoryTests.swift
//  Ruski ReportTests
//

import Testing
@testable import Ruski_Report

@MainActor
struct PublicRepositoryTests {
    @Test func discoveryMapsZeroAndTwoActiveTournaments() throws {
        let empty = PublicTournamentDiscoveryEnvelopeDTO(
            contractVersion: 2,
            tournaments: []
        )
        #expect(try PublicTournamentMapper.activeTournaments(from: empty).isEmpty)

        let two = PublicTournamentDiscoveryEnvelopeDTO(
            contractVersion: 2,
            tournaments: [
                PublicTournamentDiscoveryItemDTO(
                    projection: publicProjectionDTO(),
                    tournament: publicTournamentSummaryDTO()
                ),
                PublicTournamentDiscoveryItemDTO(
                    projection: publicProjectionDTO(
                        tournamentId: "tournament-public-2027-evening",
                        version: 2
                    ),
                    tournament: publicTournamentSummaryDTO(
                        id: "tournament-public-2027-evening",
                        name: "Evening Tournament"
                    )
                )
            ]
        )
        let tournaments = try PublicTournamentMapper.activeTournaments(from: two)

        #expect(tournaments.map(\.id) == [
            publicTournamentId,
            "tournament-public-2027-evening"
        ])
        #expect(tournaments.map(\.projection.version) == [7, 2])
    }

    @Test func detailRetainsCurrentAndHistoricalRostersAndBracketStates() throws {
        let detail = try PublicTournamentMapper.detail(
            from: PublicTournamentDetailEnvelopeDTO(
                contractVersion: 2,
                projection: publicProjectionDTO(),
                tournament: publicTournamentDTO()
            ),
            expectedTournamentId: publicTournamentId,
            expectedVersion: publicProjectionVersion
        )

        #expect(detail.name.count > 40)
        #expect(detail.pods.first?.standingState == .unresolvedTie)
        #expect(detail.pods.first?.standings.allSatisfy { $0.rank == nil } == true)
        #expect(detail.rosters.first?.players.first?.id == "player-alpha-current")
        #expect(
            detail.matches.first?.participants.first?.players.first?.id ==
                "player-alpha-original"
        )
        #expect(detail.statistics.first?.subject == .player(
            id: "player-alpha-original",
            displayName: "Original Alpha Player"
        ))
        #expect(detail.bracket?.rounds.first?.matches.first?.status == .bye)
        #expect(detail.bracket?.rounds.first?.matches.last?.slots == [.tbd, .tbd])
        #expect(detail.bracket?.rounds.last?.matches.first?.status == .corrected)
        if case .matchWinner(let source, let team, _) =
            detail.bracket?.rounds.last?.matches.first?.slots.first {
            #expect(source == "bracket-node-1")
            #expect(team?.id == "team-alpha")
        } else {
            Issue.record("Expected a match-winner bracket slot.")
        }
    }

    @Test func matchMapperSupportsEveryStatusAndScoreAvailability() throws {
        let pairs = [
            ("scheduled", "not_started", PublicMatchStatus.scheduled),
            ("in_progress", "partial", .inProgress),
            ("final", "complete", .final),
            ("final", "unrecorded", .final),
            ("forfeited", "not_applicable", .forfeited),
            ("cancelled", "not_applicable", .cancelled),
            ("postponed", "not_started", .postponed)
        ]

        for (index, pair) in pairs.enumerated() {
            let envelope = PublicMatchListEnvelopeDTO(
                contractVersion: 2,
                projection: publicProjectionDTO(),
                matches: [
                    publicMatchSummaryDTO(
                        id: "match-state-\(index)",
                        status: pair.0,
                        scoreAvailability: pair.1
                    )
                ]
            )
            let match = try #require(
                PublicMatchMapper.matches(
                    from: envelope,
                    expectedTournamentId: publicTournamentId,
                    expectedVersion: publicProjectionVersion
                ).first
            )
            #expect(match.status == pair.2)
            #expect(match.scoreAvailability.rawValue == pair.1)
        }
    }

    @Test func matchDetailMapsSelfContainedScoreSurfaces() throws {
        let detail = try PublicMatchMapper.detail(
            from: PublicMatchDetailEnvelopeDTO(
                contractVersion: 2,
                projection: publicProjectionDTO(),
                match: publicMatchDTO()
            ),
            expectedTournamentId: publicTournamentId,
            expectedMatchId: "match-pod-1",
            expectedVersion: publicProjectionVersion
        )

        #expect(detail.summary.participants.first?.team.name.hasPrefix("Alpha") == true)
        #expect(detail.summary.participants.first?.players.first?.displayName ==
            "Original Alpha Player")
        #expect(detail.events.first?.details["make"] == .bool(true))
        #expect(detail.boxScore?.rows.first?.values["makes"] == 10)
        #expect(detail.scorecard?.rows.first?.values["make"] == .bool(true))
    }

    @Test func correctedMatchRetainsBothReplacementDirections() throws {
        let source = publicMatchSummaryDTO()
        let corrected = PublicMatchSummaryDTO(
            id: source.id,
            stage: source.stage,
            sequence: source.sequence,
            podId: source.podId,
            bracketMatchId: source.bracketMatchId,
            instance: source.instance,
            revision: 3,
            status: source.status,
            scoreAvailability: source.scoreAvailability,
            correction: PublicMatchCorrectionDTO(
                isCorrection: true,
                reason: "Corrected the source workbook rows.",
                previousRevision: 2,
                replacesMatchId: "match-before-cascade",
                replacedByMatchId: "match-after-cascade"
            ),
            timestamps: source.timestamps,
            participants: source.participants,
            winner: source.winner
        )
        let match = try #require(
            PublicMatchMapper.matches(
                from: PublicMatchListEnvelopeDTO(
                    contractVersion: 2,
                    projection: publicProjectionDTO(),
                    matches: [corrected]
                ),
                expectedTournamentId: publicTournamentId,
                expectedVersion: publicProjectionVersion
            ).first
        )

        #expect(match.correction.previousRevision == 2)
        #expect(match.correction.replacesMatchId == "match-before-cascade")
        #expect(match.correction.replacedByMatchId == "match-after-cascade")
    }

    @Test func strictMappersRejectContractVersionProjectionAndIdentityMismatches() {
        #expect(throws: PublicContractValidationError.unsupportedContractVersion(1)) {
            try PublicTournamentMapper.activeTournaments(
                from: PublicTournamentDiscoveryEnvelopeDTO(
                    contractVersion: 1,
                    tournaments: []
                )
            )
        }

        #expect(throws: PublicContractValidationError.projectionVersionMismatch(
            expected: 8,
            actual: 7
        )) {
            try PublicMatchMapper.matches(
                from: PublicMatchListEnvelopeDTO(
                    contractVersion: 2,
                    projection: publicProjectionDTO(),
                    matches: []
                ),
                expectedTournamentId: publicTournamentId,
                expectedVersion: 8
            )
        }

        let duplicate = PublicTournamentDiscoveryItemDTO(
            projection: publicProjectionDTO(),
            tournament: publicTournamentSummaryDTO()
        )
        #expect(throws: PublicContractValidationError.duplicateIdentity(
            kind: "tournament",
            id: publicTournamentId
        )) {
            try PublicTournamentMapper.activeTournaments(
                from: PublicTournamentDiscoveryEnvelopeDTO(
                    contractVersion: 2,
                    tournaments: [duplicate, duplicate]
                )
            )
        }
    }

    @Test func strictTournamentMapperRejectsCrossReferenceMismatch() {
        let source = publicTournamentDTO()
        let invalidRoster = PublicRosterTeamDTO(
            id: source.rosters[0].id,
            name: source.rosters[0].name,
            podId: "missing-pod",
            initialPodSeed: source.rosters[0].initialPodSeed,
            players: source.rosters[0].players
        )
        let invalid = PublicTournamentDTO(
            id: source.id,
            gameType: source.gameType,
            year: source.year,
            name: source.name,
            lifecycle: source.lifecycle,
            format: source.format,
            rosters: [invalidRoster] + source.rosters.dropFirst(),
            pods: source.pods,
            seeds: source.seeds,
            statistics: source.statistics,
            matches: source.matches,
            bracket: source.bracket
        )

        #expect(throws: PublicContractValidationError.missingReference(
            kind: "roster pod",
            id: "missing-pod"
        )) {
            try PublicTournamentMapper.detail(
                from: PublicTournamentDetailEnvelopeDTO(
                    contractVersion: 2,
                    projection: publicProjectionDTO(),
                    tournament: invalid
                ),
                expectedTournamentId: publicTournamentId,
                expectedVersion: publicProjectionVersion
            )
        }
    }

    @Test func remoteRepositoriesUsePinnedEncodedV2Paths() async throws {
        let apiClient = RecordingAPIClient()
        apiClient.responses["v2/tournaments"] = PublicTournamentDiscoveryEnvelopeDTO(
            contractVersion: 2,
            tournaments: [
                PublicTournamentDiscoveryItemDTO(
                    projection: publicProjectionDTO(),
                    tournament: publicTournamentSummaryDTO()
                )
            ]
        )
        let encodedTournament = "tournament%20%2F%20night"
        let tournamentPath = "v2/tournaments/\(encodedTournament)?projectionVersion=7"
        let matchesPath = "v2/tournaments/\(encodedTournament)/matches?projectionVersion=7"
        apiClient.responses[tournamentPath] = PublicTournamentDetailEnvelopeDTO(
            contractVersion: 2,
            projection: publicProjectionDTO(tournamentId: "tournament / night"),
            tournament: publicTournamentWithId("tournament / night")
        )
        apiClient.responses[matchesPath] = PublicMatchListEnvelopeDTO(
            contractVersion: 2,
            projection: publicProjectionDTO(tournamentId: "tournament / night"),
            matches: []
        )
        let tournamentRepository = RemoteTournamentRepository(apiClient: apiClient)

        _ = try await tournamentRepository.activeTournaments()
        _ = try await tournamentRepository.tournament(
            id: "tournament / night",
            projectionVersion: 7
        )
        _ = try await tournamentRepository.matches(
            tournamentId: "tournament / night",
            projectionVersion: 7
        )

        let matchPath = "v2/matches/match%20%2F%201?projectionVersion=7"
        let match = publicMatchDTOWithId("match / 1")
        apiClient.responses[matchPath] = PublicMatchDetailEnvelopeDTO(
            contractVersion: 2,
            projection: publicProjectionDTO(),
            match: match
        )
        let matchRepository = RemoteMatchRepository(apiClient: apiClient)
        _ = try await matchRepository.match(
            id: "match / 1",
            tournamentId: publicTournamentId,
            projectionVersion: 7
        )

        #expect(apiClient.requestedPaths == [
            "v2/tournaments",
            tournamentPath,
            matchesPath,
            matchPath
        ])
    }

    @Test func v2RepositoryDoesNotFallBackAfterCoherenceFailure() async {
        let apiClient = RecordingAPIClient()
        let path = "v2/tournaments/\(publicTournamentId)?projectionVersion=8"
        apiClient.responses[path] = PublicTournamentDetailEnvelopeDTO(
            contractVersion: 2,
            projection: publicProjectionDTO(),
            tournament: publicTournamentDTO()
        )
        let repository = RemoteTournamentRepository(apiClient: apiClient)

        await #expect(throws: PublicContractValidationError.self) {
            try await repository.tournament(
                id: publicTournamentId,
                projectionVersion: 8
            )
        }
        #expect(apiClient.requestedPaths == [path])
    }

    @Test func v2RepositoryRejectsInvalidProjectionVersionBeforeNetworking() async {
        let apiClient = RecordingAPIClient()
        let repository = RemoteMatchRepository(apiClient: apiClient)

        await #expect(throws: PublicContractValidationError.invalidValue(
            field: "projectionVersion",
            value: "0"
        )) {
            try await repository.match(
                id: "match-1",
                tournamentId: publicTournamentId,
                projectionVersion: 0
            )
        }
        #expect(apiClient.requestedPaths.isEmpty)
    }
}

private func publicTournamentWithId(_ id: String) -> PublicTournamentDTO {
    let source = publicTournamentDTO()
    return PublicTournamentDTO(
        id: id,
        gameType: source.gameType,
        year: source.year,
        name: source.name,
        lifecycle: source.lifecycle,
        format: source.format,
        rosters: source.rosters,
        pods: source.pods,
        seeds: source.seeds,
        statistics: source.statistics,
        matches: source.matches,
        bracket: source.bracket
    )
}

private func publicMatchDTOWithId(_ id: String) -> PublicMatchDTO {
    let source = publicMatchDTO()
    return PublicMatchDTO(
        id: id,
        stage: source.stage,
        sequence: source.sequence,
        podId: source.podId,
        bracketMatchId: source.bracketMatchId,
        instance: source.instance,
        revision: source.revision,
        status: source.status,
        scoreAvailability: source.scoreAvailability,
        correction: source.correction,
        timestamps: source.timestamps,
        participants: source.participants,
        winner: source.winner,
        events: source.events,
        statistics: source.statistics,
        boxScore: source.boxScore,
        scorecard: source.scorecard
    )
}
