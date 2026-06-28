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
}
