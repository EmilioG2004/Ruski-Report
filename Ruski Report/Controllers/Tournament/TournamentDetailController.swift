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
    private let games: any GameRepository
    private let realtime: any RealtimeUpdateRepository
    private let logger: any AppLogger

    init(
        tournamentId: TournamentPreview.ID,
        tournaments: any TournamentRepository,
        games: any GameRepository,
        realtime: any RealtimeUpdateRepository = NoopRealtimeUpdateRepository(),
        logger: any AppLogger
    ) {
        self.tournamentId = tournamentId
        self.tournaments = tournaments
        self.games = games
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
            let detail = try await tournaments.tournament(id: tournamentId)
            let definition = await loadGameDefinition(for: detail.gameType)

            state = .loaded(
                TournamentDetailScreen(
                    detail: detail,
                    gameDefinition: definition
                )
            )
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

    private func loadGameDefinition(for gameType: String) async -> GameDefinition? {
        do {
            return try await games.games().first { $0.gameType == gameType }
        } catch {
            logger.log(
                .warning,
                "Unable to load game definition for tournament statistics",
                metadata: [
                    "error": String(describing: error),
                    "gameType": gameType,
                    "tournamentId": tournamentId
                ]
            )
            return nil
        }
    }
}
