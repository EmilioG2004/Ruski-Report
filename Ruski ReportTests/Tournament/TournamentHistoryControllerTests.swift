//
//  TournamentHistoryControllerTests.swift
//  Ruski ReportTests
//

import Testing
@testable import Ruski_Report

@MainActor
struct TournamentHistoryControllerTests {
    @Test func historyLoadsCompletedAndArchivedSummariesWithoutDetails() async {
        let completed = historicalSummary(
            id: "completed-2026",
            lifecycle: .completed,
            version: 12
        )
        let archived = historicalSummary(
            id: "archived-2025",
            lifecycle: .archived,
            version: 4
        )
        let repository = CanonicalControllerTournamentRepository(
            historyResults: [.success([completed, archived])]
        )
        let controller = TournamentHistoryController(
            tournaments: repository,
            logger: NoopAppLogger()
        )

        await controller.loadHistory()

        #expect(controller.state == .loaded([completed, archived]))
        #expect(repository.historyRequestCount == 1)
        #expect(repository.discoveryRequestCount == 0)
        #expect(repository.detailRequests.isEmpty)
    }

    @Test func initialHistoryFailureIsVisibleButRefreshFailurePreservesContent() async {
        let summary = historicalSummary()
        let initialFailure = CanonicalControllerTournamentRepository(
            historyResults: [
                .failure(AppError.networkUnavailable("History is offline."))
            ]
        )
        let failedController = TournamentHistoryController(
            tournaments: initialFailure,
            logger: NoopAppLogger()
        )

        await failedController.loadHistory()
        #expect(failedController.state == .failed(message: "History is offline."))

        let refreshFailure = CanonicalControllerTournamentRepository(
            historyResults: [
                .success([summary]),
                .failure(AppError.networkUnavailable("Refresh failed."))
            ]
        )
        let loadedController = TournamentHistoryController(
            tournaments: refreshFailure,
            logger: NoopAppLogger()
        )
        await loadedController.loadHistory()
        await loadedController.refreshHistory()

        #expect(loadedController.state == .loaded([summary]))
    }

    private func historicalSummary(
        id: String = "completed-2026",
        lifecycle: PublicTournamentLifecycle = .completed,
        version: Int64 = 12
    ) -> PublicTournamentSummary {
        PublicTournamentSummary(
            id: id,
            gameType: "ruski",
            year: lifecycle == .completed ? 2026 : 2025,
            name: lifecycle == .completed ? "2026 Championship" : "2025 Archive",
            lifecycle: lifecycle,
            projection: PublicProjectionReference(
                tournamentId: id,
                version: version,
                activatedAt: "2026-07-12T22:00:00.000Z"
            )
        )
    }
}
