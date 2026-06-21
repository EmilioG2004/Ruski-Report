//
//  AppRootView.swift
//  Ruski Report
//

import SwiftUI

struct AppRootView: View {
    @StateObject private var navigation = AppNavigationController()

    private let services: AppServices

    init(services: AppServices = .preview) {
        self.services = services
    }

    var body: some View {
        NavigationStack(path: $navigation.path) {
            HomeView(tournament: services.tournamentStore.featuredTournament)
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
            TournamentPlaceholderView(
                tournament: services.tournamentStore.tournament(id: id)
            )
        }
    }
}
