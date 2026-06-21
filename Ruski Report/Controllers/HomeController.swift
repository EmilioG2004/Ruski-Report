//
//  HomeController.swift
//  Ruski Report
//

import Combine
import Foundation

@MainActor
final class HomeController: ObservableObject {
    @Published private(set) var state: HomeViewState = .idle

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
        self.cachedTournaments = [initialTournament.id: initialTournament]
    }

    func loadActiveTournament() async {
        state = .loading

        do {
            let loadedTournament = try await tournaments.activeTournament()
            cachedTournaments[loadedTournament.id] = loadedTournament
            state = .loaded(loadedTournament)
        } catch {
            logger.log(
                .warning,
                "Unable to load active tournament",
                metadata: ["error": String(describing: error)]
            )
            state = .failed(message: errorMessage(from: error))
        }
    }

    func tournament(id: TournamentPreview.ID) -> TournamentPreview? {
        cachedTournaments[id]
    }

    private func errorMessage(from error: Error) -> String {
        if let errorDescription = (error as? LocalizedError)?.errorDescription,
           !errorDescription.isEmpty {
            return errorDescription
        }

        return "Unable to load the active tournament."
    }
}
