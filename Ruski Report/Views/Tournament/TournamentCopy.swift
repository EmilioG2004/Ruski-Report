//
//  TournamentCopy.swift
//  Ruski Report
//
//  Keeps tournament-facing language in one place so views remain focused on
//  presentation and future terminology changes do not require layout edits.
//

enum TournamentCopy {
    static let navigationTitle = "Tournament"
    static let gamesTitle = "Games"
    static let loadingTitle = "Loading tournament"
    static let loadingMessage = "Fetching standings, games, and bracket results."
    static let unavailableTitle = "Tournament unavailable"
    static let officialTournament = "OFFICIAL TOURNAMENT"
    static let snapshotTitle = "Tournament snapshot"
    static let snapshotSubtitle = "The official structure and published field."
    static let gamesMetric = "Games"

    static let gamesUnavailable = "Games are not available yet"
    static let liveTitle = "Live now"
    static let liveSubtitle = "Official scores update in real time."
    static let upcomingTitle = "Up next"
    static let upcomingSubtitle = "Scheduled tournament games."
    static let finalTitle = "Final"
    static let finalSubtitle = "Completed games and results."

    static let bracketUnavailable = "Bracket is not available yet"
    static let bracketTitle = AppSportsCopy.championshipBracket
    static let bracketSubtitle = "Swipe across rounds and open any published game."
    static let matchesPending = "Games pending"
    static let matchupUnavailable = "Game summary unavailable"

    static let podsUnavailable = "Pods are not available yet"
    static let podsTitle = "Pod standings"
    static let podsSubtitle = "Records, cup differential, and shooting form."
    static let teamsPending = "Teams pending"

    static let statsUnavailable = "Stats are not available yet"
    static let statsTitle = "Leaderboard"
    static let statsSubtitle = "Official tournament performance."
    static let noStatsTitle = "No statistics recorded"
    static let noStatsMessage = "Rankings will appear when official results are available."

    static func matchCount(_ count: Int) -> String {
        count == 1 ? "1 game" : "\(count) games"
    }

    static func podSummary(teamCount: Int, matchCount: Int) -> String {
        "\(teamCount) teams · \(matchCount) games"
    }
}
