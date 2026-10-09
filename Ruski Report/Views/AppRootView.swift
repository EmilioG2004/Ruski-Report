//
//  AppRootView.swift
//  Ruski Report
//

import SwiftUI

struct AppRootView: View {
    @StateObject private var navigation = AppNavigationController()
    @StateObject private var sheetRouter = AppSheetRouter()
    @StateObject private var homeController: HomeController
    @StateObject private var session: AccountSessionStore
    @StateObject private var userBlocking: UserBlockingStore

    private let services: AppServices

    init(services: AppServices = .preview) {
        self.services = services
        _session = StateObject(wrappedValue: services.session)
        _userBlocking = StateObject(
            wrappedValue: UserBlockingStore(
                blocking: services.userBlocking,
                session: services.session,
                logger: services.logger
            )
        )
        if services.usesCanonicalPublicAPI {
            _homeController = StateObject(
                wrappedValue: HomeController(
                    tournaments: services.tournaments,
                    realtime: services.realtime,
                    logger: services.logger
                )
            )
        } else {
            _homeController = StateObject(
                wrappedValue: HomeController(
                    tournaments: services.tournaments,
                    realtime: services.realtime,
                    logger: services.logger,
                    initialTournament: services.initialTournament
                )
            )
        }
    }

    var body: some View {
        NavigationStack(path: $navigation.path) {
            HomeView(
                state: homeController.state,
                retry: {
                    await homeController.loadActiveTournament()
                }
            )
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
                .task {
                    await homeController.loadActiveTournament()
                }
                .task {
                    await homeController.observeRealtimeUpdates()
                }
                .navigationDestination(for: AppRoute.self) { route in
                    destination(for: route)
                }
        }
        .sheet(item: $sheetRouter.presentedSheet) { destination in
            switch destination {
            case .account:
                AccountSessionView(
                    session: session,
                    userBlocking: userBlocking,
                    policyLinks: services.policyLinks
                )
            }
        }
        .task {
            await session.restoreSession()
        }
        .task(id: session.current) {
            await userBlocking.synchronizeWithCurrentSession()
        }
        .environmentObject(navigation)
        .environmentObject(sheetRouter)
        .tint(Color.appBrand)
    }

    @ViewBuilder
    private func destination(for route: AppRoute) -> some View {
        switch route {
        case .tournamentHistory:
            TournamentHistoryView(
                tournaments: services.tournaments,
                logger: services.logger
            )
        case .tournament(let id):
            TournamentDetailView(
                tournamentId: id,
                tournaments: services.tournaments,
                games: services.games,
                realtime: services.realtime,
                logger: services.logger
            )
        case .match(let context):
            MatchDetailView(
                routeContext: context,
                matches: services.matches,
                games: services.games,
                comments: services.comments,
                commentReports: services.commentReports,
                userBlocking: userBlocking,
                session: session,
                realtime: services.realtime,
                logger: services.logger
            )
        case .canonicalTournament(let context):
            TournamentDetailView(
                routeContext: context,
                tournaments: services.tournaments,
                games: services.games,
                realtime: services.realtime,
                logger: services.logger
            )
        case .canonicalMatch(let context):
            MatchDetailView(
                routeContext: context,
                matches: services.matches,
                tournaments: services.tournaments,
                games: services.games,
                comments: services.comments,
                commentReports: services.commentReports,
                userBlocking: userBlocking,
                session: session,
                realtime: services.realtime,
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
