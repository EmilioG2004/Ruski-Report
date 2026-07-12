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
