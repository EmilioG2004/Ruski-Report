//
//  AppNavigationController.swift
//  Ruski Report
//

import Combine
import SwiftUI

final class AppNavigationController: ObservableObject {
    @Published var path = NavigationPath()

    func showTournamentHistory() {
        path.append(AppRoute.tournamentHistory)
    }

    func showTournament(_ tournament: TournamentPreview) {
        path.append(AppRoute.tournament(id: tournament.id))
    }

    func showTournament(
        _ tournament: PublicTournamentSummary,
        discoveryScope: PublicTournamentDiscoveryScope = .active
    ) {
        path.append(
            AppRoute.canonicalTournament(
                PublicTournamentRouteContext(
                    tournamentId: tournament.id,
                    projectionVersion: tournament.projection.version,
                    discoveryScope: discoveryScope
                )
            )
        )
    }

    func showMatch(_ match: MatchPreview, in tournament: TournamentDetail) {
        showMatch(
            match,
            title: tournament.participantsLabel(for: match),
            teamNames: match.participants.map { participant in
                MatchRouteTeamName(
                    teamId: participant.teamId,
                    name: tournament.teamName(for: participant.teamId)
                )
            },
            playerNames: tournament.teams.flatMap { team in
                team.players.map { player in
                    MatchRoutePlayerName(
                        playerId: player.id,
                        name: player.displayName
                    )
                }
            }
        )
    }

    func showMatch(
        _ match: MatchPreview,
        title: String,
        teamNames: [MatchRouteTeamName],
        playerNames: [MatchRoutePlayerName] = []
    ) {
        path.append(
            AppRoute.match(
                MatchRouteContext(
                    matchId: match.id,
                    tournamentId: match.tournamentId,
                    title: title,
                    teamNames: teamNames,
                    playerNames: playerNames
                )
            )
        )
    }

    func showMatch(
        _ match: PublicMatchSummary,
        discoveryScope: PublicTournamentDiscoveryScope = .active
    ) {
        path.append(
            AppRoute.canonicalMatch(
                PublicMatchRouteContext(
                    matchId: match.id,
                    tournamentId: match.tournamentId,
                    projectionVersion: match.projection.version,
                    discoveryScope: discoveryScope
                )
            )
        )
    }

    func reset() {
        path = NavigationPath()
    }
}
