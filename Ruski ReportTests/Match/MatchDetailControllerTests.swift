//
//  MatchDetailControllerTests.swift
//  Ruski ReportTests
//

import Testing
@testable import Ruski_Report

@MainActor
struct MatchDetailControllerTests {
    @Test func loadMatchPublishesLoadedDetailWithGameDefinition() async {
        let controller = MatchDetailController(
            matchId: PreviewData.matchDetail.id,
            matches: StubMatchRepository(),
            games: StubGameRepository(),
            logger: NoopAppLogger()
        )

        await controller.loadMatch()

        #expect(
            controller.state == .loaded(
                MatchDetailScreen(
                    match: PreviewData.matchDetail,
                    gameDefinition: PreviewData.gameDefinition
                )
            )
        )
    }

    @Test func loadMatchPublishesFailureMessage() async {
        let controller = MatchDetailController(
            matchId: "missing",
            matches: StubMatchRepository(
                matchResult: .failure(
                    AppError.badStatus(code: 404, message: "Match not found.")
                )
            ),
            games: StubGameRepository(),
            logger: NoopAppLogger()
        )

        await controller.loadMatch()

        #expect(controller.state == .failed(message: "Match not found."))
    }

    @Test func loadMatchStillPublishesDetailWhenGameDefinitionFails() async {
        let controller = MatchDetailController(
            matchId: PreviewData.matchDetail.id,
            matches: StubMatchRepository(),
            games: StubGameRepository(
                gamesResult: .failure(
                    AppError.networkUnavailable("Game definitions are offline.")
                )
            ),
            logger: NoopAppLogger()
        )

        await controller.loadMatch()

        #expect(
            controller.state == .loaded(
                MatchDetailScreen(
                    match: PreviewData.matchDetail,
                    gameDefinition: nil
                )
            )
        )
    }

    @Test func realtimeTournamentUpdateReloadsVisibleMatch() async {
        let matches = StubMatchRepository()
        let realtime = StubRealtimeUpdateRepository()
        let controller = MatchDetailController(
            matchId: PreviewData.matchDetail.id,
            tournamentId: "tournament-2026",
            matches: matches,
            games: StubGameRepository(),
            realtime: realtime,
            logger: NoopAppLogger()
        )

        await controller.loadMatch()

        let observation = Task {
            await controller.observeRealtimeUpdates()
        }
        defer {
            observation.cancel()
            realtime.finish()
        }

        await waitUntil {
            realtime.subscriptions == [
                .match(
                    tournamentId: "tournament-2026",
                    matchId: PreviewData.matchDetail.id
                )
            ]
        }
        realtime.send(.tournamentUpdated(tournamentId: "tournament-2026"))
        await waitUntil {
            matches.requestedMatchIds == [
                PreviewData.matchDetail.id,
                PreviewData.matchDetail.id
            ]
        }

        #expect(
            matches.requestedMatchIds == [
                PreviewData.matchDetail.id,
                PreviewData.matchDetail.id
            ]
        )
    }

    @Test func canonicalMatchLoadsPinnedSelfContainedParticipantIdentity() async {
        let detail = controllerMatchDetail(version: 7)
        let request = matchRequest(version: 7)
        let matches = CanonicalControllerMatchRepository(
            results: [request: .success(detail)]
        )
        let controller = MatchDetailController(
            routeContext: PublicMatchRouteContext(
                matchId: detail.id,
                tournamentId: publicTournamentId,
                projectionVersion: 7
            ),
            matches: matches,
            tournaments: CanonicalControllerTournamentRepository(),
            games: StubGameRepository(),
            logger: NoopAppLogger()
        )

        await controller.loadMatch()

        #expect(controller.state == .canonicalLoaded(detail))
        #expect(matches.requests == [request])
        guard case .canonicalLoaded(let loaded) = controller.state else {
            Issue.record("Expected canonical match state.")
            return
        }
        #expect(loaded.summary.participants.first?.team.name.hasPrefix("Alpha") == true)
        #expect(loaded.summary.participants.first?.players.first?.displayName ==
            "Original Alpha Player")
    }

    @Test func canonicalMatchUnpinnedRouteDiscoversActiveProjection() async {
        let summary = controllerTournamentSummary(version: 8)
        let request = matchRequest(version: 8)
        let tournaments = CanonicalControllerTournamentRepository(
            discoveryResults: [.success([summary])]
        )
        let matches = CanonicalControllerMatchRepository(
            results: [request: .success(controllerMatchDetail(version: 8))]
        )
        let controller = MatchDetailController(
            routeContext: PublicMatchRouteContext(
                matchId: request.matchId,
                tournamentId: publicTournamentId,
                projectionVersion: nil
            ),
            matches: matches,
            tournaments: tournaments,
            games: StubGameRepository(),
            logger: NoopAppLogger()
        )

        await controller.loadMatch()

        #expect(tournaments.discoveryRequestCount == 1)
        #expect(matches.requests == [request])
    }

    @Test func canonicalHistoryMatchRediscoversHistoryProjection() async {
        let active = controllerTournamentSummary(version: 8)
        let summary = PublicTournamentSummary(
            id: active.id,
            gameType: active.gameType,
            year: 2026,
            name: "Completed Tournament",
            lifecycle: .completed,
            projection: active.projection
        )
        let request = matchRequest(version: 8)
        let tournaments = CanonicalControllerTournamentRepository(
            discoveryResults: [.failure(
                AppError.unsupported("Active discovery must not be used.")
            )],
            historyResults: [.success([summary])]
        )
        let matches = CanonicalControllerMatchRepository(
            results: [request: .success(controllerMatchDetail(version: 8))]
        )
        let controller = MatchDetailController(
            routeContext: PublicMatchRouteContext(
                matchId: request.matchId,
                tournamentId: request.tournamentId,
                projectionVersion: nil,
                discoveryScope: .history
            ),
            matches: matches,
            tournaments: tournaments,
            games: StubGameRepository(),
            logger: NoopAppLogger()
        )

        await controller.loadMatch()

        #expect(tournaments.historyRequestCount == 1)
        #expect(tournaments.discoveryRequestCount == 0)
        #expect(matches.requests == [request])
    }

    @Test func canonicalMatchRealtimeIgnoresOldAndUsesNewOrAbsentVersions() async {
        let request7 = matchRequest(version: 7)
        let request8 = matchRequest(version: 8)
        let request9 = matchRequest(version: 9)
        let matches = CanonicalControllerMatchRepository(
            results: [
                request7: .success(controllerMatchDetail(version: 7)),
                request8: .success(controllerMatchDetail(version: 8)),
                request9: .success(controllerMatchDetail(version: 9))
            ]
        )
        let summary9 = controllerTournamentSummary(version: 9)
        let tournaments = CanonicalControllerTournamentRepository(
            discoveryResults: [.success([summary9]), .success([summary9])]
        )
        let realtime = StubRealtimeUpdateRepository()
        let controller = MatchDetailController(
            routeContext: PublicMatchRouteContext(
                matchId: request7.matchId,
                tournamentId: request7.tournamentId,
                projectionVersion: 7
            ),
            matches: matches,
            tournaments: tournaments,
            games: StubGameRepository(),
            realtime: realtime,
            logger: NoopAppLogger()
        )
        await controller.loadMatch()
        let observation = Task { await controller.observeRealtimeUpdates() }
        defer {
            observation.cancel()
            realtime.finish()
        }
        await waitUntil {
            realtime.subscriptions == [
                .match(tournamentId: publicTournamentId, matchId: request7.matchId)
            ]
        }

        realtime.send(canonicalRealtimeUpdate(
            type: .matchUpdated,
            matchId: request7.matchId,
            projectionVersion: 6
        ))
        realtime.send(canonicalRealtimeUpdate(
            type: .matchUpdated,
            matchId: request7.matchId,
            projectionVersion: 7
        ))
        try? await Task.sleep(nanoseconds: 20_000_000)
        #expect(matches.requests == [request7])

        realtime.send(canonicalRealtimeUpdate(
            type: .matchUpdated,
            matchId: request7.matchId,
            projectionVersion: 8
        ))
        await waitUntil { matches.requests.contains(request8) }
        #expect(tournaments.discoveryRequestCount == 0)

        realtime.send(canonicalRealtimeUpdate(
            type: .matchUpdated,
            matchId: request7.matchId,
            projectionVersion: nil
        ))
        await waitUntil { tournaments.discoveryRequestCount == 1 }
        await waitUntil { matches.requests.contains(request9) }

        realtime.send(canonicalRealtimeUpdate(
            type: .connectionReady,
            tournamentId: "",
            projectionVersion: nil
        ))
        await waitUntil { tournaments.discoveryRequestCount == 2 }
        #expect(controller.state == .canonicalLoaded(controllerMatchDetail(version: 9)))
    }

    @Test func canonicalMatchGenerationAndSilentFailureKeepNewestCoherentDetail() async {
        let request7 = matchRequest(version: 7)
        let request8 = matchRequest(version: 8)
        let request9 = matchRequest(version: 9)
        let matches = CanonicalControllerMatchRepository(
            results: [
                request7: .success(controllerMatchDetail(version: 7)),
                request8: .success(controllerMatchDetail(version: 8)),
                request9: .failure(AppError.networkUnavailable("Refresh failed."))
            ],
            delays: [request7: 100_000_000]
        )
        let realtime = StubRealtimeUpdateRepository()
        let controller = MatchDetailController(
            routeContext: PublicMatchRouteContext(
                matchId: request7.matchId,
                tournamentId: request7.tournamentId,
                projectionVersion: 7
            ),
            matches: matches,
            tournaments: CanonicalControllerTournamentRepository(),
            games: StubGameRepository(),
            realtime: realtime,
            logger: NoopAppLogger()
        )

        let olderLoad = Task { await controller.loadMatch() }
        await waitUntil { matches.requests == [request7] }
        let observation = Task { await controller.observeRealtimeUpdates() }
        defer {
            observation.cancel()
            realtime.finish()
        }
        await waitUntil {
            realtime.subscriptions == [
                .match(tournamentId: publicTournamentId, matchId: request7.matchId)
            ]
        }
        realtime.send(canonicalRealtimeUpdate(
            type: .matchUpdated,
            matchId: request7.matchId,
            projectionVersion: 8
        ))
        await waitUntil { matches.requests.contains(request8) }
        await olderLoad.value
        #expect(controller.state == .canonicalLoaded(controllerMatchDetail(version: 8)))

        realtime.send(canonicalRealtimeUpdate(
            type: .matchUpdated,
            matchId: request7.matchId,
            projectionVersion: 9
        ))
        await waitUntil { matches.requests.contains(request9) }
        try? await Task.sleep(nanoseconds: 20_000_000)
        #expect(controller.state == .canonicalLoaded(controllerMatchDetail(version: 8)))
    }
}

private func matchRequest(
    version: Int64
) -> CanonicalControllerMatchRepository.Request {
    CanonicalControllerMatchRepository.Request(
        matchId: "match-pod-1",
        tournamentId: publicTournamentId,
        projectionVersion: version
    )
}

private extension RealtimeUpdate {
    static func tournamentUpdated(tournamentId: String) -> RealtimeUpdate {
        RealtimeUpdate(
            id: "live-test",
            type: .tournamentUpdated,
            tournamentId: tournamentId,
            matchId: nil,
            occurredAt: "2026-07-12T20:00:00.000Z",
            version: 1,
            metadata: nil
        )
    }
}

private func waitUntil(_ condition: @escaping () -> Bool) async {
    for _ in 0..<50 {
        if condition() {
            return
        }

        try? await Task.sleep(nanoseconds: 10_000_000)
    }
}
