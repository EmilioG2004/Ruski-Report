//
//  MatchDetailController.swift
//  Ruski Report
//

import Combine
import Foundation

@MainActor
final class MatchDetailController: ObservableObject {
    @Published private(set) var state: MatchDetailViewState = .loading

    private let matchId: MatchPreview.ID
    private let tournamentId: TournamentPreview.ID?
    private let matches: any MatchRepository
    private let tournaments: (any TournamentRepository)?
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
        matchId: MatchPreview.ID,
        tournamentId: TournamentPreview.ID? = nil,
        matches: any MatchRepository,
        games: any GameRepository,
        realtime: any RealtimeUpdateRepository = NoopRealtimeUpdateRepository(),
        logger: any AppLogger
    ) {
        self.matchId = matchId
        self.tournamentId = tournamentId
        self.matches = matches
        self.tournaments = nil
        self.games = games
        self.realtime = realtime
        self.logger = logger
        self.mode = .legacy
        self.requestedProjectionVersion = nil
    }

    init(
        routeContext: PublicMatchRouteContext,
        matches: any MatchRepository,
        tournaments: any TournamentRepository,
        games: any GameRepository,
        realtime: any RealtimeUpdateRepository = NoopRealtimeUpdateRepository(),
        logger: any AppLogger
    ) {
        self.matchId = routeContext.matchId
        self.tournamentId = routeContext.tournamentId
        self.matches = matches
        self.tournaments = tournaments
        self.games = games
        self.realtime = realtime
        self.logger = logger
        self.mode = .canonical
        self.requestedProjectionVersion = routeContext.projectionVersion
    }

    func loadMatch() async {
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
        for await update in realtime.updates(
            subscription: .match(tournamentId: tournamentId, matchId: matchId)
        ) {
            switch mode {
            case .legacy:
                guard shouldRefreshLegacy(for: update) else {
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
            let match = try await matches.match(id: matchId)
            let definition = await loadGameDefinition(for: match.preview.gameType)
            guard generation == loadGeneration else {
                return
            }

            state = .loaded(
                MatchDetailScreen(match: match, gameDefinition: definition)
            )
        } catch {
            guard generation == loadGeneration else {
                return
            }
            logger.log(
                .warning,
                "Unable to load match detail",
                metadata: [
                    "error": String(describing: error),
                    "matchId": matchId
                ]
            )
            if showFailure {
                state = .failed(
                    message: AppErrorMessageFormatter.message(
                        from: error,
                        fallback: "Unable to load match details."
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
                throw AppError.unsupported("Match projection is unavailable.")
            }
            guard let tournamentId else {
                throw AppError.unsupported("Match tournament identity is unavailable.")
            }
            let match = try await matches.match(
                id: matchId,
                tournamentId: tournamentId,
                projectionVersion: version
            )
            guard generation == loadGeneration else {
                return
            }
            requestedProjectionVersion = match.summary.projection.version
            currentProjection = match.summary.projection
            state = .canonicalLoaded(match)
        } catch {
            guard generation == loadGeneration else {
                return
            }
            logger.log(
                .warning,
                "Unable to load canonical match detail",
                metadata: [
                    "error": String(describing: error),
                    "matchId": matchId,
                    "projectionVersion": projectionVersion.map { String($0) } ?? "active"
                ]
            )
            if showFailure {
                state = .failed(
                    message: AppErrorMessageFormatter.message(
                        from: error,
                        fallback: "Unable to load match details."
                    )
                )
            }
        }
    }

    private func shouldRefreshLegacy(for update: RealtimeUpdate) -> Bool {
        if update.type == .connectionReady {
            return true
        }
        switch update.type {
        case .matchUpdated, .commentsUpdated:
            if let updateMatchId = update.matchId {
                return updateMatchId == matchId
            }

            return update.tournamentId == tournamentId
        case .tournamentUpdated:
            return update.tournamentId == tournamentId
        case .connectionReady, .error, .unknown:
            return false
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
        guard update.type == .matchUpdated || update.type == .tournamentUpdated,
              update.tournamentId == tournamentId,
              update.matchId == nil || update.matchId == matchId else {
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
        guard let tournaments, let tournamentId else {
            throw AppError.unsupported("Active match projection is unavailable.")
        }
        let active = try await tournaments.activeTournaments()
        guard let summary = active.first(where: { $0.id == tournamentId }) else {
            throw AppError.unsupported("Active match tournament is unavailable.")
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
                "Unable to load game definition for match detail",
                metadata: [
                    "error": String(describing: error),
                    "gameType": gameType,
                    "matchId": matchId
                ]
            )
            return nil
        }
    }
}
