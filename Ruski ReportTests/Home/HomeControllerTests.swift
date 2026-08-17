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
