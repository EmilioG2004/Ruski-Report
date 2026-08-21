//
//  TournamentHistoryView.swift
//  Ruski Report
//

import SwiftUI

struct TournamentHistoryView: View {
    @StateObject private var controller: TournamentHistoryController

    @EnvironmentObject private var navigation: AppNavigationController

    init(
        tournaments: any TournamentRepository,
        logger: any AppLogger
    ) {
        _controller = StateObject(
            wrappedValue: TournamentHistoryController(
                tournaments: tournaments,
                logger: logger
            )
        )
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: AppLayout.sectionSpacing) {
                content
            }
            .padding(AppLayout.pagePadding)
            .frame(maxWidth: AppLayout.maximumContentWidth, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Color.appGroupedBackground)
        .navigationTitle("Tournament history")
        .appInlineNavigationTitle()
        .refreshable {
            await controller.refreshHistory()
        }
        .task {
            await controller.loadHistory()
        }
        .tint(Color.appBrand)
    }

    @ViewBuilder
    private var content: some View {
        switch controller.state {
        case .idle, .loading:
            AppLoadingStateView(
                title: "Loading tournament history",
                message: "Finding completed and archived tournaments."
            )
            .accessibilityIdentifier("history.loading")
        case .loaded(let tournaments):
            if tournaments.isEmpty {
                AppEmptyStateView(
                    title: "No tournament history",
                    message: "Completed tournaments will appear here.",
                    systemImage: "clock.arrow.circlepath"
                )
                .accessibilityIdentifier("history.empty")
            } else {
                AppSectionHeader(
                    "Past tournaments",
                    subtitle: "Completed and archived official tournaments.",
                    count: tournaments.count
                )
                ForEach(tournaments) { tournament in
                    historyCard(tournament)
                }
            }
        case .failed(let message):
            AppErrorStateView(
                title: "Tournament history unavailable",
                message: message
            ) {
                Task { await controller.loadHistory() }
            }
            .accessibilityIdentifier("history.error")
        }
    }

    private func historyCard(_ tournament: PublicTournamentSummary) -> some View {
        Button {
            navigation.showTournament(tournament, discoveryScope: .history)
        } label: {
            AppSurface {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: AppLayout.compactSpacing) {
                        lifecycleLabel(tournament)
                        Spacer(minLength: AppLayout.smallSpacing)
                        seasonLabel(tournament)
                    }

                    VStack(alignment: .leading, spacing: AppLayout.smallSpacing) {
                        lifecycleLabel(tournament)
                        seasonLabel(tournament)
                    }
                }

                Text(tournament.name)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)

                Label("Open official results", systemImage: "arrow.right.circle.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.appBrand)
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("history.tournament.\(tournament.id)")
        .accessibilityHint(
            "Opens this tournament at projection \(tournament.projection.version)"
        )
    }

    private func lifecycleLabel(
        _ tournament: PublicTournamentSummary
    ) -> some View {
        Label(tournament.lifecycle.displayName, systemImage: "trophy.fill")
            .font(.caption.weight(.bold))
            .foregroundStyle(Color.appBrand)
    }

    private func seasonLabel(
        _ tournament: PublicTournamentSummary
    ) -> some View {
        Text("\(tournament.year) · v\(tournament.projection.version)")
            .font(.caption.weight(.semibold).monospacedDigit())
            .foregroundStyle(.secondary)
    }
}
