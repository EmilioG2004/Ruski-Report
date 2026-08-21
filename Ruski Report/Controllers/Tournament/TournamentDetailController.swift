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
    private let mode: Mode
    private var requestedProjectionVersion: Int64?
    private var currentProjection: PublicProjectionReference?
    private var loadGeneration = 0

    private enum Mode {
        case legacy
        case canonical
    }

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
        self.mode = .legacy
        self.requestedProjectionVersion = nil
    }

    init(
        routeContext: PublicTournamentRouteContext,
        tournaments: any TournamentRepository,
        games: any GameRepository,
        realtime: any RealtimeUpdateRepository = NoopRealtimeUpdateRepository(),
        logger: any AppLogger
    ) {
        self.tournamentId = routeContext.tournamentId
        self.tournaments = tournaments
        self.games = games
        self.realtime = realtime
        self.logger = logger
        self.mode = .canonical
        self.requestedProjectionVersion = routeContext.projectionVersion
    }

    func loadTournament() async {
        switch mode {
        case .legacy:
            await loadLegacy(showLoading: true, showFailure: true)
        case .canonical:
            await loadCanonical(
                projectionVersion: requestedProjectionVersion,
                discoverActive: requestedProjectionVersion == nil,
                showLoading: true,
                showFailure: true
            )
        }
    }

    func observeRealtimeUpdates() async {
        for await update in realtime.updates(subscription: .tournament(id: tournamentId)) {
            switch mode {
            case .legacy:
                guard (update.type == .tournamentUpdated &&
                        update.tournamentId == tournamentId) ||
                        update.type == .connectionReady else {
                    continue
                }
                await loadLegacy(showLoading: false, showFailure: false)
            case .canonical:
                await handleCanonical(update)
            }
        }
    }

    private func loadLegacy(
        showLoading: Bool,
        showFailure: Bool
    ) async {
        let generation = beginLoad(showLoading: showLoading)

        do {
            let detail = try await tournaments.tournament(id: tournamentId)
            let definition = await loadGameDefinition(for: detail.gameType)
            guard generation == loadGeneration else {
                return
            }

            state = .loaded(
                TournamentDetailScreen(
                    detail: detail,
                    gameDefinition: definition
                )
            )
        } catch {
            guard generation == loadGeneration else {
                return
            }
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

    private func loadCanonical(
        projectionVersion: Int64?,
        discoverActive: Bool,
        showLoading: Bool,
        showFailure: Bool
    ) async {
        let generation = beginLoad(showLoading: showLoading)

        do {
            let version: Int64
            if discoverActive || projectionVersion == nil {
                version = try await activeProjectionVersion()
            } else if let projectionVersion {
                version = projectionVersion
            } else {
                throw AppError.unsupported("Tournament projection is unavailable.")
            }
            let detail = try await tournaments.tournament(
                id: tournamentId,
                projectionVersion: version
            )
            guard generation == loadGeneration else {
                return
            }
            requestedProjectionVersion = detail.projection.version
            currentProjection = detail.projection
            state = .canonicalLoaded(detail)
        } catch {
            guard generation == loadGeneration else {
                return
            }
            logger.log(
                .warning,
                "Unable to load canonical tournament detail",
                metadata: [
                    "error": String(describing: error),
                    "tournamentId": tournamentId,
                    "projectionVersion": projectionVersion.map { String($0) } ?? "active"
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

    private func handleCanonical(_ update: RealtimeUpdate) async {
        if update.type == .connectionReady {
            await loadCanonical(
                projectionVersion: nil,
                discoverActive: true,
                showLoading: false,
                showFailure: false
            )
            return
        }
        guard update.type == .tournamentUpdated || update.type == .matchUpdated,
              update.tournamentId == tournamentId else {
            return
        }
        guard let version = update.projectionVersion else {
            await loadCanonical(
                projectionVersion: nil,
                discoverActive: true,
                showLoading: false,
                showFailure: false
            )
            return
        }
        if let currentProjection, version <= currentProjection.version {
            return
        }
        await loadCanonical(
            projectionVersion: version,
            discoverActive: false,
            showLoading: false,
            showFailure: false
        )
    }

    private func activeProjectionVersion() async throws -> Int64 {
        let active = try await tournaments.activeTournaments()
        guard let summary = active.first(where: { $0.id == tournamentId }) else {
            throw AppError.unsupported("Active tournament projection is unavailable.")
        }
        return summary.projection.version
    }

    private func beginLoad(showLoading: Bool) -> Int {
        loadGeneration += 1
        if showLoading {
            state = .loading
        }
        return loadGeneration
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
