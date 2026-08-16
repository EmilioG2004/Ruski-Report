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
    private let games: any GameRepository
    private let realtime: any RealtimeUpdateRepository
    private let logger: any AppLogger

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
        self.games = games
        self.realtime = realtime
        self.logger = logger
    }

    func loadMatch() async {
        await loadMatch(showLoading: true, showFailure: true)
    }

    func observeRealtimeUpdates() async {
        for await update in realtime.updates(
            subscription: .match(tournamentId: tournamentId, matchId: matchId)
        ) {
            guard shouldRefresh(for: update) else {
                continue
            }

            await loadMatch(showLoading: false, showFailure: false)
        }
    }

    private func loadMatch(
        showLoading: Bool,
        showFailure: Bool
    ) async {
        if showLoading {
            state = .loading
        }

        do {
            let match = try await matches.match(id: matchId)
            let definition = await loadGameDefinition(for: match.preview.gameType)

            state = .loaded(
                MatchDetailScreen(match: match, gameDefinition: definition)
            )
        } catch {
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

    private func shouldRefresh(for update: RealtimeUpdate) -> Bool {
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
