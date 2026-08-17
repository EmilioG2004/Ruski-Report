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
    private let realtime: any RealtimeUpdateRepository
    private let logger: any AppLogger
    private var cachedTournaments: [TournamentPreview.ID: TournamentPreview]

    init(
        tournaments: any TournamentRepository,
        realtime: any RealtimeUpdateRepository = NoopRealtimeUpdateRepository(),
        logger: any AppLogger,
        initialTournament: TournamentPreview
    ) {
        self.tournaments = tournaments
        self.realtime = realtime
        self.logger = logger
        self.cachedTournaments = [initialTournament.id: initialTournament]
    }

    func loadActiveTournament() async {
        await loadActiveTournament(showLoading: true, showFailure: true)
    }

    func observeRealtimeUpdates() async {
        for await update in realtime.updates(subscription: .all) {
            guard update.type == .tournamentUpdated else {
                continue
            }

            await loadActiveTournament(showLoading: false, showFailure: false)
        }
    }

    private func loadActiveTournament(
        showLoading: Bool,
        showFailure: Bool
    ) async {
        if showLoading {
            state = .loading
        }

        do {
            let loadedTournament = try await tournaments.activeTournament()
            cachedTournaments[loadedTournament.id] = loadedTournament
            let detail = await loadTournamentDetail(for: loadedTournament)
            state = .loaded(
                HomeScreen(
                    tournament: loadedTournament,
                    detail: detail
                )
            )
        } catch {
            logger.log(
                .warning,
                "Unable to load active tournament",
                metadata: ["error": String(describing: error)]
            )
            if showFailure {
                state = .failed(
                    message: AppErrorMessageFormatter.message(
                        from: error,
                        fallback: "Unable to load the active tournament."
                    )
                )
            }
        }
    }

    func tournament(id: TournamentPreview.ID) -> TournamentPreview? {
        cachedTournaments[id]
    }

    private func loadTournamentDetail(
        for tournament: TournamentPreview
    ) async -> TournamentDetail? {
        do {
            return try await tournaments.tournament(id: tournament.id)
        } catch {
            logger.log(
                .warning,
                "Unable to load home score feed",
                metadata: [
                    "error": String(describing: error),
                    "tournamentId": tournament.id
                ]
            )
            return nil
        }
    }
}
