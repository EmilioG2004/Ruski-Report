//
//  TournamentDetailView.swift
//  Ruski Report
//
//  Owns tournament loading and destination selection while delegating every
//  content surface to a focused section view.
//

import SwiftUI

struct TournamentDetailView: View {
    @StateObject private var controller: TournamentDetailController
    @State private var selectedSection: TournamentDetailSection = .matches

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
                    title: TournamentCopy.loadingTitle,
                    message: TournamentCopy.loadingMessage
                )
                    .accessibilityIdentifier("tournament.loading")
            case .loaded(let screen):
                detailContent(screen)
            case .failed(let message):
                errorContent(message)
            }
        }
        .background(Color.appGroupedBackground)
        .navigationTitle(TournamentCopy.navigationTitle)
        .appInlineNavigationTitle()
        .tint(Color.appBrand)
        .task {
            await controller.loadTournament()
        }
        .task {
            await controller.observeRealtimeUpdates()
        }
    }

    private func detailContent(_ screen: TournamentDetailScreen) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppLayout.largeSpacing) {
                TournamentOverviewHeader(detail: screen.detail)

                TournamentSectionPicker(selection: $selectedSection)

                sectionContent(screen)
                    .id(selectedSection)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
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
            title: TournamentCopy.unavailableTitle,
            message: message
        ) {
            Task {
                await controller.loadTournament()
            }
        }
        .accessibilityIdentifier("tournament.error")
    }
}
