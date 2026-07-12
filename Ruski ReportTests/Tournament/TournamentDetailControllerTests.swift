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
            logger: NoopAppLogger()
        )

        await controller.loadTournament()

        #expect(controller.state == .loaded(PreviewData.tournamentDetail))
    }

    @Test func loadTournamentPublishesFailureMessage() async {
        let controller = TournamentDetailController(
            tournamentId: "missing",
            tournaments: StubTournamentRepository(
                tournamentResult: .failure(
                    AppError.badStatus(code: 404, message: "Tournament not found.")
                )
            ),
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
