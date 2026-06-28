//
//  AppRoute.swift
//  Ruski Report
//

import Foundation

enum AppRoute: Hashable {
    case tournament(id: TournamentPreview.ID)
    case match(MatchRouteContext)
}

nonisolated struct MatchRouteContext: Hashable {
    let matchId: MatchPreview.ID
    let title: String
    let teamNames: [MatchRouteTeamName]
    let playerNames: [MatchRoutePlayerName]

    var teamNamesById: [String: String] {
        Dictionary(uniqueKeysWithValues: teamNames.map { ($0.teamId, $0.name) })
    }

    var playerNamesById: [String: String] {
        Dictionary(uniqueKeysWithValues: playerNames.map { ($0.playerId, $0.name) })
    }

    func teamName(for teamId: String?) -> String? {
        guard let teamId else {
            return nil
        }

        return teamNamesById[teamId] ?? teamId
    }

    func playerName(for playerId: String?) -> String? {
        guard let playerId else {
            return nil
        }

        return playerNamesById[playerId] ?? playerId
    }
}

nonisolated struct MatchRouteTeamName: Hashable {
    let teamId: String
    let name: String
}

nonisolated struct MatchRoutePlayerName: Hashable {
    let playerId: String
    let name: String
}
