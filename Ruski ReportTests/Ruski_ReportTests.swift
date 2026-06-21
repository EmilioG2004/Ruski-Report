//
//  Ruski_ReportTests.swift
//  Ruski ReportTests
//
//  Created by Emilio Lukas Garci on 5/15/26.
//

import Testing
import SwiftUI
@testable import Ruski_Report

struct Ruski_ReportTests {

    @Test func featuredTournamentUsesRuskiReportShellData() async throws {
        let repository = PreviewTournamentRepository()
        let tournament = try await repository.activeTournament()

        #expect(tournament.id == "tournament-2026")
        #expect(tournament.name == "2026 Ruski Tournament")
        #expect(tournament.status == .scheduled)
    }

    @MainActor
    @Test func appNavigationStartsAtHome() {
        let navigation = AppNavigationController()

        #expect(navigation.path.isEmpty)
    }

    @MainActor
    @Test func homeControllerDependsOnTournamentRepository() async throws {
        let controller = HomeController(
            tournaments: PreviewTournamentRepository(),
            logger: NoopAppLogger(),
            initialTournament: PreviewData.tournamentPreview
        )

        await controller.loadActiveTournament()

        #expect(controller.tournament.id == "tournament-2026")
        #expect(controller.tournament(id: "tournament-2026") != nil)
    }

}
