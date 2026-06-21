//
//  HomeController.swift
//  Ruski Report
//

import Combine
import Foundation

@MainActor
final class HomeController: ObservableObject {
    @Published private(set) var tournament: TournamentPreview

    private let tournaments: any TournamentRepository
    private let logger: any AppLogger
    private var cachedTournaments: [TournamentPreview.ID: TournamentPreview]

    init(
        tournaments: any TournamentRepository,
        logger: any AppLogger,
        initialTournament: TournamentPreview
    ) {
        self.tournaments = tournaments
        self.logger = logger
        self.tournament = initialTournament
        self.cachedTournaments = [initialTournament.id: initialTournament]
    }

    func loadActiveTournament() async {
        do {
            let loadedTournament = try await tournaments.activeTournament()
            tournament = loadedTournament
            cachedTournaments[loadedTournament.id] = loadedTournament
        } catch {
            logger.log(
                .warning,
                "Unable to load active tournament",
                metadata: ["error": String(describing: error)]
            )
        }
    }

    func tournament(id: TournamentPreview.ID) -> TournamentPreview? {
        cachedTournaments[id]
    }
}
