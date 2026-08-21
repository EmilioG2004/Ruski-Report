//
//  AppSportsCopy.swift
//  Ruski Report
//
//  Centralizes compact language shared across score feeds, brackets, and game
//  headers without coupling reusable sports components to a feature module.
//

nonisolated enum AppSportsCopy {
    static let gameCenter = "Game center"
    static let teamsPending = "Teams will be announced"
    static let championshipBracket = "Championship bracket"
    static let winner = "Winner"
    static let scoreNotRecorded = "Score not recorded"
    static let scoreNotRecordedMessage =
        "The source workbook identifies the winner but has no scorecard for this game."

    static func seed(_ value: Int) -> String {
        "Seed \(value)"
    }
}
