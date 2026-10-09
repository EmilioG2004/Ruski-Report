//
//  HomeControllerTests.swift
//  Ruski ReportTests
//

import Testing
@testable import Ruski_Report

@MainActor
struct HomeControllerTests {
    @Test func loadActiveTournamentPublishesLoadedState() async {
        let controller = HomeController(
            tournaments: StubTournamentRepository(
                activeTournamentResult: .success(PreviewData.tournamentPreview)
            ),
            logger: NoopAppLogger(),
            initialTournament: PreviewData.tournamentPreview
        )

        #expect(controller.state == .idle)

        await controller.loadActiveTournament()

        #expect(
            controller.state == .loaded(
                HomeScreen(
                    tournament: PreviewData.tournamentPreview,
                    detail: PreviewData.tournamentDetail
                )
            )
        )
        #expect(controller.tournament(id: "tournament-2026") != nil)
    }

    @Test func loadActiveTournamentPublishesFailureState() async {
        let controller = HomeController(
            tournaments: StubTournamentRepository(
                activeTournamentResult: .failure(
                    AppError.networkUnavailable("The tournament API is offline.")
                )
            ),
            logger: NoopAppLogger(),
            initialTournament: PreviewData.tournamentPreview
        )

        await controller.loadActiveTournament()

        #expect(
            controller.state == .failed(message: "The tournament API is offline.")
        )
    }

    @Test func loadActiveTournamentKeepsSummaryWhenScoreFeedFails() async {
        let controller = HomeController(
            tournaments: StubTournamentRepository(
                activeTournamentResult: .success(PreviewData.tournamentPreview),
                tournamentResult: .failure(
                    AppError.networkUnavailable("Tournament details are offline.")
                )
            ),
            logger: NoopAppLogger(),
            initialTournament: PreviewData.tournamentPreview
        )

        await controller.loadActiveTournament()

        #expect(
            controller.state == .loaded(
                HomeScreen(
                    tournament: PreviewData.tournamentPreview,
                    detail: nil
                )
            )
        )
    }

    @Test func homeScreenGroupsLiveUpcomingAndFinalGames() {
        let screen = HomeScreen(
            tournament: PreviewData.tournamentPreview,
            detail: PreviewData.tournamentDetail
        )

        #expect(screen.liveMatches.map(\.id) == [PreviewData.openingMatch.id])
        #expect(screen.upcomingMatches.map(\.id) == [PreviewData.secondMatch.id])
        #expect(screen.completedMatches.map(\.id) == [PreviewData.championshipMatch.id])
    }

    @Test func homeScreenBuildsOrderedFeedSections() {
        let screen = HomeScreen(
            tournament: PreviewData.tournamentPreview,
            detail: PreviewData.tournamentDetail
        )

        #expect(screen.matchSections.map(\.kind) == [.live, .upcoming, .completed])
        #expect(screen.matchSections.map(\.matches.count) == [1, 1, 1])
        #expect(screen.matchSections.map(\.title) == ["Live now", "Up next", "Latest results"])
    }

    @Test func realtimeTournamentUpdateReloadsActiveTournament() async {
        let tournaments = StubTournamentRepository()
        let realtime = StubRealtimeUpdateRepository()
        let controller = HomeController(
            tournaments: tournaments,
            realtime: realtime,
            logger: NoopAppLogger(),
            initialTournament: PreviewData.tournamentPreview
        )

        await controller.loadActiveTournament()

        let observation = Task {
            await controller.observeRealtimeUpdates()
        }
        defer {
            observation.cancel()
            realtime.finish()
        }

        await waitUntil { realtime.subscriptions == [.all] }
        realtime.send(.tournamentUpdated(tournamentId: "tournament-2026"))
        await waitUntil { tournaments.activeTournamentRequestCount == 2 }

        #expect(tournaments.activeTournamentRequestCount == 2)
    }

    @Test func canonicalHomeSupportsZeroActiveTournaments() async {
        let tournaments = CanonicalControllerTournamentRepository(
            discoveryResults: [.success([])]
        )
        let controller = HomeController(
            tournaments: tournaments,
            logger: NoopAppLogger()
        )

        await controller.loadActiveTournament()

        #expect(
            controller.state == .canonicalLoaded(
                PublicHomeScreen(tournaments: [], detailsByTournamentId: [:])
            )
        )
    }

    @Test func canonicalHomeLoadsOnePinnedTournament() async {
        let summary = controllerTournamentSummary()
        let request = CanonicalControllerTournamentRepository.DetailRequest(
            tournamentId: summary.id,
            projectionVersion: summary.projection.version
        )
        let detail = controllerTournamentDetail(summary: summary)
        let tournaments = CanonicalControllerTournamentRepository(
            discoveryResults: [.success([summary])],
            detailResults: [request: .success(detail)]
        )
        let controller = HomeController(
            tournaments: tournaments,
            logger: NoopAppLogger()
        )

        await controller.loadActiveTournament()

        #expect(
            controller.state == .canonicalLoaded(
                PublicHomeScreen(
                    tournaments: [summary],
                    detailsByTournamentId: [summary.id: detail]
                )
            )
        )
        #expect(tournaments.detailRequests == [request])
    }

    @Test func canonicalHomeKeepsTwoSummariesWhenOnePinnedDetailFails() async {
        let first = controllerTournamentSummary()
        let second = controllerTournamentSummary(
            id: "tournament-evening",
            version: 3,
            name: "Evening Tournament"
        )
        let firstRequest = CanonicalControllerTournamentRepository.DetailRequest(
            tournamentId: first.id,
            projectionVersion: first.projection.version
        )
        let secondRequest = CanonicalControllerTournamentRepository.DetailRequest(
            tournamentId: second.id,
            projectionVersion: second.projection.version
        )
        let tournaments = CanonicalControllerTournamentRepository(
            discoveryResults: [.success([first, second])],
            detailResults: [
                firstRequest: .success(controllerTournamentDetail(summary: first)),
                secondRequest: .failure(
                    AppError.networkUnavailable("Evening detail is offline.")
                )
            ]
        )
        let controller = HomeController(
            tournaments: tournaments,
            logger: NoopAppLogger()
        )

        await controller.loadActiveTournament()

        guard case .canonicalLoaded(let screen) = controller.state else {
            Issue.record("Expected canonical home state.")
            return
        }
        #expect(screen.tournaments.map(\.id) == [first.id, second.id])
        #expect(screen.detail(for: first.id)?.projection == first.projection)
        #expect(screen.detail(for: second.id) == nil)
        #expect(tournaments.detailRequests == [firstRequest, secondRequest])
    }

    @Test func canonicalHomeGenerationPreventsOlderCompletionOverwritingNewer() async {
        let old = controllerTournamentSummary(version: 7, name: "Old Projection")
        let new = controllerTournamentSummary(version: 8, name: "New Projection")
        let oldRequest = CanonicalControllerTournamentRepository.DetailRequest(
            tournamentId: old.id,
            projectionVersion: old.projection.version
        )
        let newRequest = CanonicalControllerTournamentRepository.DetailRequest(
            tournamentId: new.id,
            projectionVersion: new.projection.version
        )
        let tournaments = CanonicalControllerTournamentRepository(
            discoveryResults: [.success([old]), .success([new])],
            discoveryDelays: [100_000_000, 0],
            detailResults: [
                oldRequest: .success(controllerTournamentDetail(summary: old)),
                newRequest: .success(controllerTournamentDetail(summary: new))
            ]
        )
        let controller = HomeController(
            tournaments: tournaments,
            logger: NoopAppLogger()
        )

        let olderLoad = Task { await controller.loadActiveTournament() }
        await waitUntil { tournaments.discoveryRequestCount == 1 }
        await controller.loadActiveTournament()
        await olderLoad.value

        guard case .canonicalLoaded(let screen) = controller.state else {
            Issue.record("Expected canonical home state.")
            return
        }
        #expect(screen.tournaments.first?.name == "New Projection")
        #expect(screen.tournaments.first?.projection.version == 8)
    }

    @Test func canonicalHomeRealtimeIgnoresOldVersionsAndRefreshesNewOrAbsentVersions() async {
        let version7 = controllerTournamentSummary(version: 7)
        let version8 = controllerTournamentSummary(version: 8)
        let version9 = controllerTournamentSummary(version: 9)
        let requests = [version7, version8, version9].map {
            CanonicalControllerTournamentRepository.DetailRequest(
                tournamentId: $0.id,
                projectionVersion: $0.projection.version
            )
        }
        let tournaments = CanonicalControllerTournamentRepository(
            discoveryResults: [
                .success([version7]),
                .success([version8]),
                .success([version9]),
                .success([version9])
            ],
            detailResults: Dictionary(
                uniqueKeysWithValues: zip(requests, [version7, version8, version9]).map {
                    ($0.0, .success(controllerTournamentDetail(summary: $0.1)))
                }
            )
        )
        let realtime = StubRealtimeUpdateRepository()
        let controller = HomeController(
            tournaments: tournaments,
            realtime: realtime,
            logger: NoopAppLogger()
        )
        await controller.loadActiveTournament()
        let observation = Task { await controller.observeRealtimeUpdates() }
        defer {
            observation.cancel()
            realtime.finish()
        }
        await waitUntil { realtime.subscriptions == [.all] }

        realtime.send(canonicalRealtimeUpdate(projectionVersion: 6))
        realtime.send(canonicalRealtimeUpdate(projectionVersion: 7))
        try? await Task.sleep(nanoseconds: 20_000_000)
        #expect(tournaments.discoveryRequestCount == 1)

        realtime.send(canonicalRealtimeUpdate(projectionVersion: 8))
        await waitUntil { tournaments.discoveryRequestCount == 2 }
        realtime.send(canonicalRealtimeUpdate(projectionVersion: nil))
        await waitUntil { tournaments.discoveryRequestCount == 3 }
        realtime.send(canonicalRealtimeUpdate(
            type: .connectionReady,
            tournamentId: "",
            projectionVersion: nil
        ))
        await waitUntil { tournaments.discoveryRequestCount == 4 }

        guard case .canonicalLoaded(let screen) = controller.state else {
            Issue.record("Expected canonical home state.")
            return
        }
        #expect(screen.tournaments.first?.projection.version == 9)
    }

    @Test func canonicalHomeSilentRefreshFailurePreservesPriorCoherentState() async {
        let summary = controllerTournamentSummary(version: 7)
        let request = CanonicalControllerTournamentRepository.DetailRequest(
            tournamentId: summary.id,
            projectionVersion: summary.projection.version
        )
        let detail = controllerTournamentDetail(summary: summary)
        let tournaments = CanonicalControllerTournamentRepository(
            discoveryResults: [
                .success([summary]),
                .failure(AppError.networkUnavailable("Refresh failed."))
            ],
            detailResults: [request: .success(detail)]
        )
        let realtime = StubRealtimeUpdateRepository()
        let controller = HomeController(
            tournaments: tournaments,
            realtime: realtime,
            logger: NoopAppLogger()
        )
        await controller.loadActiveTournament()
        let expected = controller.state
        let observation = Task { await controller.observeRealtimeUpdates() }
        defer {
            observation.cancel()
            realtime.finish()
        }
        await waitUntil { realtime.subscriptions == [.all] }

        realtime.send(canonicalRealtimeUpdate(
            type: .connectionReady,
            tournamentId: "",
            projectionVersion: nil
        ))
        await waitUntil { tournaments.discoveryRequestCount == 2 }
        try? await Task.sleep(nanoseconds: 20_000_000)

        #expect(controller.state == expected)
    }
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
