//
//  AppRootView.swift
//  Ruski Report
//

import SwiftUI

struct AppRootView: View {
    @StateObject private var navigation = AppNavigationController()
    @StateObject private var homeController: HomeController

    private let services: AppServices

    init(services: AppServices = .preview) {
        self.services = services
        _homeController = StateObject(
            wrappedValue: HomeController(
                tournaments: services.tournaments,
                logger: services.logger,
                initialTournament: services.initialTournament
            )
        )
    }

    var body: some View {
        NavigationStack(path: $navigation.path) {
            HomeView(
                state: homeController.state,
                retry: {
                    await homeController.loadActiveTournament()
                }
            )
                .task {
                    await homeController.loadActiveTournament()
                }
                .navigationDestination(for: AppRoute.self) { route in
                    destination(for: route)
                }
        }
        .environmentObject(navigation)
    }

    @ViewBuilder
    private func destination(for route: AppRoute) -> some View {
        switch route {
        case .tournament(let id):
            TournamentDetailView(
                tournamentId: id,
                tournaments: services.tournaments,
                logger: services.logger
            )
        case .match(let context):
            MatchDetailView(
                routeContext: context,
                matches: services.matches,
                games: services.games,
                comments: services.comments,
                session: services.session,
                logger: services.logger
            )
        }
    }
}
