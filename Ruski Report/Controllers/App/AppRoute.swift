//
//  AppRoute.swift
//  Ruski Report
//

import Foundation

enum AppRoute: Hashable {
    case tournamentHistory
    case tournament(id: TournamentPreview.ID)
    case match(MatchRouteContext)
    case canonicalTournament(PublicTournamentRouteContext)
    case canonicalMatch(PublicMatchRouteContext)
}

nonisolated enum PublicTournamentDiscoveryScope: Hashable {
    case active
    case history
}

nonisolated struct PublicTournamentRouteContext: Hashable {
    let tournamentId: PublicTournamentSummary.ID
    let projectionVersion: Int64?
    let discoveryScope: PublicTournamentDiscoveryScope

    init(
        tournamentId: PublicTournamentSummary.ID,
        projectionVersion: Int64?,
        discoveryScope: PublicTournamentDiscoveryScope = .active
    ) {
        self.tournamentId = tournamentId
        self.projectionVersion = projectionVersion
        self.discoveryScope = discoveryScope
    }
}

nonisolated struct PublicMatchRouteContext: Hashable {
    let matchId: PublicMatchSummary.ID
    let tournamentId: PublicTournamentSummary.ID
    let projectionVersion: Int64?
    let discoveryScope: PublicTournamentDiscoveryScope

    init(
        matchId: PublicMatchSummary.ID,
        tournamentId: PublicTournamentSummary.ID,
        projectionVersion: Int64?,
        discoveryScope: PublicTournamentDiscoveryScope = .active
    ) {
        self.matchId = matchId
        self.tournamentId = tournamentId
        self.projectionVersion = projectionVersion
        self.discoveryScope = discoveryScope
    }
}

nonisolated struct MatchRouteContext: Hashable {
    let matchId: MatchPreview.ID
    let tournamentId: TournamentPreview.ID
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
