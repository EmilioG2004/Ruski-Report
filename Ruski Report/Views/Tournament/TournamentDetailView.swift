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
                ProgressView("Loading tournament")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
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

                Picker("Tournament section", selection: $selectedSection) {
                    ForEach(TournamentDetailSection.allCases) { section in
                        Text(section.title).tag(section)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("tournament.sectionPicker")

                sectionContent(screen)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
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
        ContentUnavailableView {
            Label("Tournament unavailable", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button("Retry") {
                Task {
                    await controller.loadTournament()
                }
            }
            .accessibilityIdentifier("tournament.retry")
        }
    }
}

private enum TournamentDetailSection: String, CaseIterable, Identifiable {
    case overview
    case pods
    case matches
    case bracket
    case stats

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview:
            "Overview"
        case .pods:
            "Pods"
        case .matches:
            "Matches"
        case .bracket:
            "Bracket"
        case .stats:
            "Stats"
        }
    }
}
