//
//  PublicHomeScoreFeedView.swift
//  Ruski Report
//
//  Displays every active canonical tournament. Detail payloads are optional so
//  one tournament can fail independently without hiding the rest of Home.
//

import SwiftUI

struct PublicHomeScoreFeedView: View {
    let screen: PublicHomeScreen

    @EnvironmentObject private var navigation: AppNavigationController

    var body: some View {
        if screen.tournaments.isEmpty {
            AppSurface {
                AppEmptyStateView(
                    title: "No active tournaments",
                    message: "Published tournaments will appear here when play begins.",
                    systemImage: "trophy"
                )
            }
            .accessibilityIdentifier("home.public.empty")
        } else {
            VStack(alignment: .leading, spacing: AppLayout.sectionSpacing) {
                AppSectionHeader(
                    "Active tournaments",
                    subtitle: activeTournamentSubtitle,
                    count: screen.tournaments.count
                )

                ForEach(screen.tournaments) { tournament in
                    let detail = screen.detailsByTournamentId[tournament.id]
                    PublicHomeTournamentSection(
                        tournament: tournament,
                        detail: detail,
                        openTournament: {
                            navigation.showTournament(tournament)
                        },
                        openMatch: { match in
                            navigation.showMatch(match)
                        }
                    )
                }
            }
            .accessibilityIdentifier("home.public.loaded")
        }
    }

    private var activeTournamentSubtitle: String {
        screen.tournaments.count == 1
            ? "The official tournament currently in play."
            : "Every official tournament currently in play."
    }
}

private struct PublicHomeTournamentSection: View {
    let tournament: PublicTournamentSummary
    let detail: PublicTournamentDetail?
    let openTournament: () -> Void
    let openMatch: (PublicMatchSummary) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
            PublicTournamentCardView(
                tournament: tournament,
                detail: detail,
                action: openTournament
            )

            if let detail {
                let matches = featuredMatches(in: detail)
                if !matches.isEmpty {
                    VStack(alignment: .leading, spacing: AppLayout.compactSpacing) {
                        Text("Featured games")
                            .font(.headline)

                        ForEach(matches) { match in
                            PublicMatchScoreCard(
                                match: match,
                                accessibilityIdentifier: "home.public.match.\(match.id)"
                            ) {
                                openMatch(match)
                            }
                        }
                    }
                }
            } else {
                AppSurface(style: .inset) {
                    Label(
                        "Game cards are temporarily unavailable.",
                        systemImage: "arrow.triangle.2.circlepath"
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityIdentifier("home.public.tournament.\(tournament.id).unavailable")
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func featuredMatches(
        in detail: PublicTournamentDetail
    ) -> [PublicMatchSummary] {
        let priority: [PublicMatchStatus] = [
            .inProgress,
            .scheduled,
            .postponed,
            .final,
            .forfeited,
            .cancelled
        ]
        return priority.flatMap { status in
            detail.matches.filter { $0.status == status }.prefix(1)
        }
    }
}

private struct PublicTournamentCardView: View {
    let tournament: PublicTournamentSummary
    let detail: PublicTournamentDetail?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: AppLayout.largeSpacing) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: AppLayout.compactSpacing) {
                        lifecycleLabel
                        Spacer(minLength: AppLayout.smallSpacing)
                        seasonLabel
                    }

                    VStack(alignment: .leading, spacing: AppLayout.smallSpacing) {
                        lifecycleLabel
                        seasonLabel
                    }
                }

                Text(tournament.name)
                    .font(.title2.weight(.black))
                    .fixedSize(horizontal: false, vertical: true)

                if let detail {
                    HStack(spacing: AppLayout.largeSpacing) {
                        Label("\(detail.rosters.count) teams", systemImage: "person.3.fill")
                        Label("\(detail.matches.count) games", systemImage: "sportscourt.fill")
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(
                        Color.white.opacity(AppVisualTokens.strongOnBrandOpacity)
                    )
                }

                Divider()
                    .overlay(
                        Color.white.opacity(AppVisualTokens.dividerOnBrandOpacity)
                    )

                HStack {
                    Text("Open tournament")
                        .font(.headline)
                    Spacer()
                    Image(systemName: "arrow.right.circle.fill")
                        .font(.title3)
                        .accessibilityHidden(true)
                }
            }
            .foregroundStyle(Color.appOnBrand)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(AppLayout.heroPadding)
            .background(Color.appBrandGradient)
            .clipShape(
                RoundedRectangle(
                    cornerRadius: AppLayout.surfaceRadius,
                    style: .continuous
                )
            )
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        .accessibilityIdentifier("home.public.tournament.\(tournament.id)")
        .accessibilityLabel(
            "\(tournament.name), \(tournament.year), " +
                "\(tournament.lifecycle.displayName), " +
                "projection \(tournament.projection.version)"
        )
        .accessibilityHint("Opens this tournament at projection \(tournament.projection.version)")
    }

    private var lifecycleLabel: some View {
        Label(tournament.lifecycle.displayName, systemImage: "trophy.fill")
            .font(.caption.weight(.bold))
            .padding(.horizontal, AppLayout.pillHorizontalPadding)
            .padding(.vertical, AppLayout.pillVerticalPadding)
            .background(
                Color.white.opacity(AppVisualTokens.statusPillOnBrandOpacity)
            )
            .clipShape(Capsule())
    }

    private var seasonLabel: some View {
        Text("\(tournament.year) · v\(tournament.projection.version)")
            .font(.subheadline.weight(.bold).monospacedDigit())
    }
}
