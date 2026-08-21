//
//  TournamentDetailControllerTests.swift
//  Ruski ReportTests
//

import Testing
@testable import Ruski_Report

@MainActor
struct TournamentDetailControllerTests {
    @Test func loadTournamentPublishesLoadedDetail() async {
        let controller = TournamentDetailController(
            tournamentId: "tournament-2026",
            tournaments: StubTournamentRepository(),
            games: StubGameRepository(),
            logger: NoopAppLogger()
        )

        await controller.loadTournament()

        #expect(
            controller.state == .loaded(
                TournamentDetailScreen(
                    detail: PreviewData.tournamentDetail,
                    gameDefinition: PreviewData.gameDefinition
                )
            )
        )
    }

    @Test func loadTournamentPublishesFailureMessage() async {
        let controller = TournamentDetailController(
            tournamentId: "missing",
            tournaments: StubTournamentRepository(
                tournamentResult: .failure(
                    AppError.badStatus(code: 404, message: "Tournament not found.")
                )
            ),
            games: StubGameRepository(),
            logger: NoopAppLogger()
        )

        await controller.loadTournament()

        #expect(controller.state == .failed(message: "Tournament not found."))
    }

    @Test func realtimeTournamentUpdateReloadsTournamentDetail() async {
        let tournaments = StubTournamentRepository()
        let realtime = StubRealtimeUpdateRepository()
        let controller = TournamentDetailController(
            tournamentId: "tournament-2026",
            tournaments: tournaments,
            games: StubGameRepository(),
            realtime: realtime,
            logger: NoopAppLogger()
        )

        await controller.loadTournament()

        let observation = Task {
            await controller.observeRealtimeUpdates()
        }
        defer {
            observation.cancel()
            realtime.finish()
        }

        await waitUntil {
            realtime.subscriptions == [.tournament(id: "tournament-2026")]
        }
        realtime.send(.tournamentUpdated(tournamentId: "tournament-2026"))
        await waitUntil {
            tournaments.requestedTournamentIds == [
                "tournament-2026",
                "tournament-2026"
            ]
        }

        #expect(
            tournaments.requestedTournamentIds == [
                "tournament-2026",
                "tournament-2026"
            ]
        )
    }

    @Test func statisticColumnsUseGameDefinitionMetadataAndFallbackLabels() {
        let screen = TournamentDetailScreen(
            detail: PreviewData.tournamentDetail,
            gameDefinition: PreviewData.gameDefinition
        )
        let table = TournamentStatisticTable(
            id: "test-stats",
            name: "Test Stats",
            scope: "season",
            subjectType: "player",
            statKeys: ["makes", "customMetric"],
            rows: []
        )

        let columns = screen.statisticColumns(for: table)

        #expect(columns.map(\.label) == ["Cups Made", "Custom Metric"])
        #expect(columns.map(\.valueType) == ["count", "number"])
    }

    @Test func canonicalTournamentLoadsTheExactPinnedProjection() async {
        let summary = controllerTournamentSummary(version: 7)
        let request = CanonicalControllerTournamentRepository.DetailRequest(
            tournamentId: summary.id,
            projectionVersion: 7
        )
        let detail = controllerTournamentDetail(summary: summary)
        let tournaments = CanonicalControllerTournamentRepository(
            detailResults: [request: .success(detail)]
        )
        let controller = TournamentDetailController(
            routeContext: PublicTournamentRouteContext(
                tournamentId: summary.id,
                projectionVersion: 7
            ),
            tournaments: tournaments,
            games: StubGameRepository(),
            logger: NoopAppLogger()
        )

        await controller.loadTournament()

        #expect(controller.state == .canonicalLoaded(detail))
        #expect(tournaments.discoveryRequestCount == 0)
        #expect(tournaments.detailRequests == [request])
    }

    @Test func canonicalTournamentUnpinnedRouteDiscoversActiveVersion() async {
        let summary = controllerTournamentSummary(version: 8)
        let request = CanonicalControllerTournamentRepository.DetailRequest(
            tournamentId: summary.id,
            projectionVersion: 8
        )
        let tournaments = CanonicalControllerTournamentRepository(
            discoveryResults: [.success([summary])],
            detailResults: [
                request: .success(controllerTournamentDetail(summary: summary))
            ]
        )
        let controller = TournamentDetailController(
            routeContext: PublicTournamentRouteContext(
                tournamentId: summary.id,
                projectionVersion: nil
            ),
            tournaments: tournaments,
            games: StubGameRepository(),
            logger: NoopAppLogger()
        )

        await controller.loadTournament()

        #expect(tournaments.discoveryRequestCount == 1)
        #expect(tournaments.detailRequests == [request])
    }

    @Test func canonicalHistoryRouteRediscoversHistoryVersion() async {
        let active = controllerTournamentSummary(version: 8)
        let summary = PublicTournamentSummary(
            id: active.id,
            gameType: active.gameType,
            year: 2026,
            name: "Completed Tournament",
            lifecycle: .completed,
            projection: active.projection
        )
        let request = CanonicalControllerTournamentRepository.DetailRequest(
            tournamentId: summary.id,
            projectionVersion: 8
        )
        let tournaments = CanonicalControllerTournamentRepository(
            discoveryResults: [.failure(
                AppError.unsupported("Active discovery must not be used.")
            )],
            historyResults: [.success([summary])],
            detailResults: [
                request: .success(controllerTournamentDetail(summary: summary))
            ]
        )
        let controller = TournamentDetailController(
            routeContext: PublicTournamentRouteContext(
                tournamentId: summary.id,
                projectionVersion: nil,
                discoveryScope: .history
            ),
            tournaments: tournaments,
            games: StubGameRepository(),
            logger: NoopAppLogger()
        )

        await controller.loadTournament()

        #expect(tournaments.historyRequestCount == 1)
        #expect(tournaments.discoveryRequestCount == 0)
        #expect(tournaments.detailRequests == [request])
    }

    @Test func canonicalTournamentRealtimeUsesNewerVersionAndRediscoversAbsentVersion() async {
        let version7 = controllerTournamentSummary(version: 7)
        let version8 = controllerTournamentSummary(version: 8)
        let version9 = controllerTournamentSummary(version: 9)
        let request7 = request(for: version7)
        let request8 = request(for: version8)
        let request9 = request(for: version9)
        let tournaments = CanonicalControllerTournamentRepository(
            discoveryResults: [.success([version9]), .success([version9])],
            detailResults: [
                request7: .success(controllerTournamentDetail(summary: version7)),
                request8: .success(controllerTournamentDetail(summary: version8)),
                request9: .success(controllerTournamentDetail(summary: version9))
            ]
        )
        let realtime = StubRealtimeUpdateRepository()
        let controller = TournamentDetailController(
            routeContext: PublicTournamentRouteContext(
                tournamentId: version7.id,
                projectionVersion: 7
            ),
            tournaments: tournaments,
            games: StubGameRepository(),
            realtime: realtime,
            logger: NoopAppLogger()
        )
        await controller.loadTournament()
        let observation = Task { await controller.observeRealtimeUpdates() }
        defer {
            observation.cancel()
            realtime.finish()
        }
        await waitUntil {
            realtime.subscriptions == [.tournament(id: publicTournamentId)]
        }

        realtime.send(canonicalRealtimeUpdate(projectionVersion: 6))
        realtime.send(canonicalRealtimeUpdate(projectionVersion: 7))
        try? await Task.sleep(nanoseconds: 20_000_000)
        #expect(tournaments.detailRequests == [request7])

        realtime.send(canonicalRealtimeUpdate(projectionVersion: 8))
        await waitUntil { tournaments.detailRequests.contains(request8) }
        #expect(tournaments.discoveryRequestCount == 0)

        realtime.send(canonicalRealtimeUpdate(projectionVersion: nil))
        await waitUntil { tournaments.discoveryRequestCount == 1 }
        await waitUntil { tournaments.detailRequests.contains(request9) }

        realtime.send(canonicalRealtimeUpdate(
            type: .connectionReady,
            tournamentId: "",
            projectionVersion: nil
        ))
        await waitUntil { tournaments.discoveryRequestCount == 2 }

        #expect(controller.state == .canonicalLoaded(
            controllerTournamentDetail(summary: version9)
        ))
    }

    @Test func canonicalTournamentGenerationAndSilentFailurePreserveNewestState() async {
        let version7 = controllerTournamentSummary(version: 7)
        let version8 = controllerTournamentSummary(version: 8)
        let version9 = controllerTournamentSummary(version: 9)
        let request7 = request(for: version7)
        let request8 = request(for: version8)
        let request9 = request(for: version9)
        let tournaments = CanonicalControllerTournamentRepository(
            detailResults: [
                request7: .success(controllerTournamentDetail(summary: version7)),
                request8: .success(controllerTournamentDetail(summary: version8)),
                request9: .failure(AppError.networkUnavailable("Refresh failed."))
            ],
            detailDelays: [request7: 100_000_000]
        )
        let realtime = StubRealtimeUpdateRepository()
        let controller = TournamentDetailController(
            routeContext: PublicTournamentRouteContext(
                tournamentId: publicTournamentId,
                projectionVersion: 7
            ),
            tournaments: tournaments,
            games: StubGameRepository(),
            realtime: realtime,
            logger: NoopAppLogger()
        )

        let oldLoad = Task { await controller.loadTournament() }
        await waitUntil { tournaments.detailRequests == [request7] }
        let observation = Task { await controller.observeRealtimeUpdates() }
        defer {
            observation.cancel()
            realtime.finish()
        }
        await waitUntil {
            realtime.subscriptions == [.tournament(id: publicTournamentId)]
        }
        realtime.send(canonicalRealtimeUpdate(projectionVersion: 8))
        await waitUntil { tournaments.detailRequests.contains(request8) }
        await oldLoad.value

        #expect(controller.state == .canonicalLoaded(
            controllerTournamentDetail(summary: version8)
        ))

        realtime.send(canonicalRealtimeUpdate(projectionVersion: 9))
        await waitUntil { tournaments.detailRequests.contains(request9) }
        try? await Task.sleep(nanoseconds: 20_000_000)
        #expect(controller.state == .canonicalLoaded(
            controllerTournamentDetail(summary: version8)
        ))
    }
}

private func request(
    for summary: PublicTournamentSummary
) -> CanonicalControllerTournamentRepository.DetailRequest {
    CanonicalControllerTournamentRepository.DetailRequest(
        tournamentId: summary.id,
        projectionVersion: summary.projection.version
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
