//
//  AppRootView.swift
//  Ruski Report
//

import SwiftUI

struct AppRootView: View {
    @StateObject private var navigation = AppNavigationController()
    @StateObject private var sheetRouter = AppSheetRouter()
    @StateObject private var homeController: HomeController
    @StateObject private var session: LocalSessionRepository

    private let services: AppServices

    init(services: AppServices = .preview) {
        self.services = services
        _session = StateObject(wrappedValue: services.session)
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
        .toolbar {
            ToolbarItem(placement: accountToolbarPlacement) {
                Button {
                    sheetRouter.showAccount()
                } label: {
                    Label("Account", systemImage: accountIconName)
                        .labelStyle(.iconOnly)
                }
                .accessibilityIdentifier("account.toolbar")
            }
        }
        .sheet(item: $sheetRouter.presentedSheet) { destination in
            switch destination {
            case .account:
                AccountSessionView(session: session)
            }
        }
        .environmentObject(navigation)
        .environmentObject(sheetRouter)
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
                session: session,
                logger: services.logger
            )
        }
    }

    private var accountIconName: String {
        switch session.current {
        case .guest:
            "person.crop.circle"
        case .authenticated:
            "person.crop.circle.fill"
        case .admin:
            "person.crop.circle.badge.checkmark"
        }
    }

    private var accountToolbarPlacement: ToolbarItemPlacement {
        #if os(macOS)
        .automatic
        #else
        .topBarTrailing
        #endif
    }
}
