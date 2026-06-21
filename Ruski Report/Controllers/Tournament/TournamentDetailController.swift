//
//  TournamentDetailController.swift
//  Ruski Report
//

import Combine
import Foundation

@MainActor
final class TournamentDetailController: ObservableObject {
    @Published private(set) var state: TournamentDetailViewState = .loading

    private let tournamentId: TournamentPreview.ID
    private let tournaments: any TournamentRepository
    private let logger: any AppLogger

    init(
        tournamentId: TournamentPreview.ID,
        tournaments: any TournamentRepository,
        logger: any AppLogger
    ) {
        self.tournamentId = tournamentId
        self.tournaments = tournaments
        self.logger = logger
    }

    func loadTournament() async {
        state = .loading

        do {
            state = .loaded(try await tournaments.tournament(id: tournamentId))
        } catch {
            logger.log(
                .warning,
                "Unable to load tournament detail",
                metadata: [
                    "error": String(describing: error),
                    "tournamentId": tournamentId
                ]
            )
            state = .failed(
                message: AppErrorMessageFormatter.message(
                    from: error,
                    fallback: "Unable to load tournament details."
                )
            )
        }
    }
}
