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
}
