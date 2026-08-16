//
//  TournamentDetailView.swift
//  Ruski Report
//

import SwiftUI

struct TournamentDetailView: View {
    @StateObject private var controller: TournamentDetailController
    @State private var selectedSection: TournamentDetailSection = .overview

    init(
        tournamentId: TournamentPreview.ID,
        tournaments: any TournamentRepository,
        games: any GameRepository,
        realtime: any RealtimeUpdateRepository,
        logger: any AppLogger
    ) {
        _controller = StateObject(
            wrappedValue: TournamentDetailController(
                tournamentId: tournamentId,
                tournaments: tournaments,
                games: games,
                realtime: realtime,
                logger: logger
            )
        )
    }

    var body: some View {
        Group {
            switch controller.state {
            case .loading:
                AppLoadingStateView(
                    title: "Loading tournament",
                    message: "Fetching standings, matches, and bracket results."
                )
                    .accessibilityIdentifier("tournament.loading")
            case .loaded(let screen):
                detailContent(screen)
            case .failed(let message):
                errorContent(message)
            }
        }
        .background(Color.appGroupedBackground)
        .navigationTitle("Tournament")
        .appInlineNavigationTitle()
        .task {
            await controller.loadTournament()
        }
        .task {
            await controller.observeRealtimeUpdates()
        }
    }

    private func detailContent(_ screen: TournamentDetailScreen) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                TournamentOverviewHeader(detail: screen.detail)

                TournamentSectionPicker(selection: $selectedSection)

                sectionContent(screen)
            }
            .padding(AppLayout.pagePadding)
            .frame(
                maxWidth: AppLayout.maximumContentWidth,
                alignment: .leading
            )
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder
    private func sectionContent(_ screen: TournamentDetailScreen) -> some View {
        switch selectedSection {
        case .overview:
            TournamentOverviewView(detail: screen.detail)
        case .pods:
            TournamentPodsView(detail: screen.detail)
        case .matches:
            TournamentMatchesView(detail: screen.detail)
        case .bracket:
            TournamentBracketView(detail: screen.detail)
        case .stats:
            TournamentStatsView(screen: screen)
        }
    }

    private func errorContent(_ message: String) -> some View {
        AppErrorStateView(
            title: "Tournament unavailable",
            message: message
        ) {
            Task {
                await controller.loadTournament()
            }
        }
        .accessibilityIdentifier("tournament.error")
    }
}
