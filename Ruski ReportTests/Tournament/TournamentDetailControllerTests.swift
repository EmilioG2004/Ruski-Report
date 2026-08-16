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
