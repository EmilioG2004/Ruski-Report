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
    private let mode: Mode
    private var cachedTournaments: [TournamentPreview.ID: TournamentPreview]
    private var loadGeneration = 0

    private enum Mode {
        case legacy
        case canonical
    }

    init(
        tournaments: any TournamentRepository,
        realtime: any RealtimeUpdateRepository = NoopRealtimeUpdateRepository(),
        logger: any AppLogger,
        initialTournament: TournamentPreview
    ) {
        self.tournaments = tournaments
        self.realtime = realtime
        self.logger = logger
        self.mode = .legacy
        self.cachedTournaments = [initialTournament.id: initialTournament]
    }

    init(
        tournaments: any TournamentRepository,
        realtime: any RealtimeUpdateRepository = NoopRealtimeUpdateRepository(),
        logger: any AppLogger
    ) {
        self.tournaments = tournaments
        self.realtime = realtime
        self.logger = logger
        self.mode = .canonical
        self.cachedTournaments = [:]
    }

    func loadActiveTournament() async {
        await loadActiveTournament(showLoading: true, showFailure: true)
    }

    func observeRealtimeUpdates() async {
        for await update in realtime.updates(subscription: .all) {
            switch mode {
            case .legacy:
                guard update.type == .tournamentUpdated ||
                        update.type == .connectionReady else {
                    continue
                }
                await loadLegacy(showLoading: false, showFailure: false)
            case .canonical:
                guard shouldRefreshCanonicalHome(for: update) else {
                    continue
                }
                await loadCanonical(showLoading: false, showFailure: false)
            }
        }
    }

    private func loadActiveTournament(
        showLoading: Bool,
        showFailure: Bool
    ) async {
        switch mode {
        case .legacy:
            await loadLegacy(showLoading: showLoading, showFailure: showFailure)
        case .canonical:
            await loadCanonical(showLoading: showLoading, showFailure: showFailure)
        }
    }

    private func loadLegacy(
        showLoading: Bool,
        showFailure: Bool
    ) async {
        let generation = beginLoad(showLoading: showLoading)

        do {
            let loadedTournament = try await tournaments.activeTournament()
            let detail = await loadTournamentDetail(for: loadedTournament)
            guard generation == loadGeneration else {
                return
            }
            cachedTournaments[loadedTournament.id] = loadedTournament
            state = .loaded(
                HomeScreen(
                    tournament: loadedTournament,
                    detail: detail
                )
            )
        } catch {
            guard generation == loadGeneration else {
                return
            }
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

    private func loadCanonical(
        showLoading: Bool,
        showFailure: Bool
    ) async {
        let generation = beginLoad(showLoading: showLoading)

        do {
            let summaries = try await tournaments.activeTournaments()
            var details: [String: PublicTournamentDetail] = [:]
            for summary in summaries {
                do {
                    let detail = try await tournaments.tournament(
                        id: summary.id,
                        projectionVersion: summary.projection.version
                    )
                    guard detail.projection == summary.projection else {
                        throw PublicContractValidationError.incoherent(
                            "Home detail did not match its discovered projection."
                        )
                    }
                    details[summary.id] = detail
                } catch {
                    logger.log(
                        .warning,
                        "Unable to load a canonical home tournament detail",
                        metadata: [
                            "error": String(describing: error),
                            "tournamentId": summary.id,
                            "projectionVersion": String(summary.projection.version)
                        ]
                    )
                }
            }

            guard generation == loadGeneration else {
                return
            }
            state = .canonicalLoaded(
                PublicHomeScreen(
                    tournaments: summaries,
                    detailsByTournamentId: details
                )
            )
        } catch {
            guard generation == loadGeneration else {
                return
            }
            logger.log(
                .warning,
                "Unable to load active canonical tournaments",
                metadata: ["error": String(describing: error)]
            )
            if showFailure {
                state = .failed(
                    message: AppErrorMessageFormatter.message(
                        from: error,
                        fallback: "Unable to load active tournaments."
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

    private func beginLoad(showLoading: Bool) -> Int {
        loadGeneration += 1
        if showLoading {
            state = .loading
        }
        return loadGeneration
    }

    private func shouldRefreshCanonicalHome(for update: RealtimeUpdate) -> Bool {
        if update.type == .connectionReady {
            return true
        }
        guard update.type == .tournamentUpdated || update.type == .matchUpdated else {
            return false
        }
        guard let projectionVersion = update.projectionVersion else {
            return true
        }
        guard case .canonicalLoaded(let screen) = state,
              let tournamentId = update.tournamentId,
              let current = screen.tournaments.first(where: { $0.id == tournamentId }) else {
            return true
        }
        return projectionVersion > current.projection.version
    }
}
