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
    private let matches: any MatchRepository
    private let games: any GameRepository
    private let logger: any AppLogger

    init(
        matchId: MatchPreview.ID,
        matches: any MatchRepository,
        games: any GameRepository,
        logger: any AppLogger
    ) {
        self.matchId = matchId
        self.matches = matches
        self.games = games
        self.logger = logger
    }

    func loadMatch() async {
        state = .loading

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
            state = .failed(
                message: AppErrorMessageFormatter.message(
                    from: error,
                    fallback: "Unable to load match details."
                )
            )
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
