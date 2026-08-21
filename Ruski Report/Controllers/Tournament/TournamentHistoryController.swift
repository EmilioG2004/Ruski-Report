//
//  TournamentHistoryController.swift
//  Ruski Report
//

import Combine
import Foundation

@MainActor
final class TournamentHistoryController: ObservableObject {
    @Published private(set) var state: TournamentHistoryViewState = .idle

    private let tournaments: any TournamentRepository
    private let logger: any AppLogger
    private var loadGeneration = 0

    init(
        tournaments: any TournamentRepository,
        logger: any AppLogger
    ) {
        self.tournaments = tournaments
        self.logger = logger
    }

    func loadHistory() async {
        await loadHistory(showLoading: true, showFailure: true)
    }

    func refreshHistory() async {
        await loadHistory(showLoading: false, showFailure: false)
    }

    private func loadHistory(
        showLoading: Bool,
        showFailure: Bool
    ) async {
        loadGeneration += 1
        let generation = loadGeneration
        if showLoading {
            state = .loading
        }

        do {
            let summaries = try await tournaments.historicalTournaments()
            guard generation == loadGeneration else {
                return
            }
            state = .loaded(summaries)
        } catch {
            guard generation == loadGeneration else {
                return
            }
            logger.log(
                .warning,
                "Unable to load tournament history",
                metadata: ["operation": "history_discovery"]
            )
            if showFailure {
                state = .failed(
                    message: AppErrorMessageFormatter.message(
                        from: error,
                        fallback: "Unable to load tournament history."
                    )
                )
            }
        }
    }
}
