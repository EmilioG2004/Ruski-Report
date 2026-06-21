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

        #expect(controller.state == .loaded(PreviewData.tournamentPreview))
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
}

private final class StubTournamentRepository: TournamentRepository {
    private let activeTournamentResult: Result<TournamentPreview, Error>

    init(activeTournamentResult: Result<TournamentPreview, Error>) {
        self.activeTournamentResult = activeTournamentResult
    }

    func activeTournament() async throws -> TournamentPreview {
        try activeTournamentResult.get()
    }

    func tournament(id: TournamentPreview.ID) async throws -> TournamentDetail {
        PreviewData.tournamentDetail
    }

    func matches(tournamentId: TournamentPreview.ID) async throws -> [MatchPreview] {
        []
    }
}
