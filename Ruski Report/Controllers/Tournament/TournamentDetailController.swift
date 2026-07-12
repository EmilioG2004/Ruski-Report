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
    private let realtime: any RealtimeUpdateRepository
    private let logger: any AppLogger

    init(
        tournamentId: TournamentPreview.ID,
        tournaments: any TournamentRepository,
        realtime: any RealtimeUpdateRepository = NoopRealtimeUpdateRepository(),
        logger: any AppLogger
    ) {
        self.tournamentId = tournamentId
        self.tournaments = tournaments
        self.realtime = realtime
        self.logger = logger
    }

    func loadTournament() async {
        await loadTournament(showLoading: true, showFailure: true)
    }

    func observeRealtimeUpdates() async {
        for await update in realtime.updates(subscription: .tournament(id: tournamentId)) {
            guard update.type == .tournamentUpdated,
                  update.tournamentId == tournamentId else {
                continue
            }

            await loadTournament(showLoading: false, showFailure: false)
        }
    }

    private func loadTournament(
        showLoading: Bool,
        showFailure: Bool
    ) async {
        if showLoading {
            state = .loading
        }

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
            if showFailure {
                state = .failed(
                    message: AppErrorMessageFormatter.message(
                        from: error,
                        fallback: "Unable to load tournament details."
                    )
                )
            }
        }
    }
}
