//
//  HomeCopy.swift
//  Ruski Report
//
//  Centralizes home-screen language so information hierarchy can evolve or be
//  localized without editing view composition.
//

nonisolated enum HomeCopy {
    static let navigationTitle = "Scores"
    static let eyebrow = "RUSKI REPORT"
    static let title = "Tournament HQ"
    static let subtitle =
        "Live games, official standings, and every path to the championship."

    static let loadingTitle = "Loading tournament"
    static let loadingMessage = "Fetching the latest official tournament summary."
    static let errorTitle = "Tournament unavailable"
    static let emptyTitle = "Games are not posted yet"
    static let emptyMessage =
        "The tournament hub is ready and will show games when the official schedule is published."
    static let feedUnavailable =
        "Game cards are temporarily unavailable. Open the tournament to try again."
    static let liveTitle = "Live now"
    static let liveSubtitle = "Scores update as the official sheet changes."
    static let upcomingTitle = "Up next"
    static let upcomingSubtitle = "Scheduled games in the active tournament."
    static let completedTitle = "Latest results"

    static func featuredGameCount(_ count: Int) -> String {
        "\(count) featured \(count == 1 ? "game" : "games")"
    }
}
