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
        realtime: any RealtimeUpdateRepository,
        logger: any AppLogger
    ) {
        _controller = StateObject(
            wrappedValue: TournamentDetailController(
                tournamentId: tournamentId,
                tournaments: tournaments,
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
            case .loaded(let detail):
                detailContent(detail)
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

    private func detailContent(_ detail: TournamentDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                TournamentOverviewHeader(detail: detail)

                Picker("Tournament section", selection: $selectedSection) {
                    ForEach(TournamentDetailSection.allCases) { section in
                        Text(section.title).tag(section)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("tournament.sectionPicker")

                sectionContent(detail)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func sectionContent(_ detail: TournamentDetail) -> some View {
        switch selectedSection {
        case .overview:
            TournamentOverviewView(detail: detail)
        case .pods:
            TournamentPodsView(detail: detail)
        case .matches:
            TournamentMatchesView(detail: detail)
        case .bracket:
            TournamentBracketView(detail: detail)
        case .stats:
            TournamentStatsView(detail: detail)
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
