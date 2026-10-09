//
//  HomeScoreFeedView.swift
//  Ruski Report
//
//  Composes the loaded tournament card and score sections. Navigation is
//  injected so this feed remains previewable and independent from app routing.
//

import SwiftUI

struct HomeScoreFeedView: View {
    let screen: HomeScreen
    let openTournament: (TournamentPreview) -> Void
    let openMatch: (MatchPreview, TournamentDetail) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.sectionSpacing) {
            TournamentCardView(tournament: screen.tournament) {
                openTournament(screen.tournament)
            }

            if let detail = screen.detail {
                HomeMatchSectionsView(
                    sections: screen.matchSections,
                    detail: detail,
                    openMatch: openMatch
                )
            } else {
                HomeFeedUnavailableView()
            }
        }
    }
}

private struct HomeMatchSectionsView: View {
    let sections: [HomeMatchSection]
    let detail: TournamentDetail
    let openMatch: (MatchPreview, TournamentDetail) -> Void

    var body: some View {
        if detail.matches.isEmpty {
            AppSurface {
                AppEmptyStateView(
                    title: HomeCopy.emptyTitle,
                    message: HomeCopy.emptyMessage,
                    systemImage: "sportscourt"
                )
            }
            .accessibilityIdentifier("home.matches.empty")
        } else {
            ForEach(sections) { section in
                HomeMatchSectionView(
                    section: section,
                    detail: detail,
                    openMatch: openMatch
                )
            }
        }
    }
}

private struct HomeMatchSectionView: View {
    let section: HomeMatchSection
    let detail: TournamentDetail
    let openMatch: (MatchPreview, TournamentDetail) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
            AppSectionHeader(
                section.title,
                subtitle: section.subtitle,
                count: section.matches.count
            )

            ForEach(section.matches) { match in
                MatchScoreCard(
                    match: match,
                    teamName: detail.teamName,
                    context: TournamentMatchContextFormatter.label(
                        for: match,
                        in: detail
                    ),
                    accessibilityIdentifier: "home.match.\(match.id)"
                ) {
                    openMatch(match, detail)
                }
            }
        }
    }
}

private struct HomeFeedUnavailableView: View {
    var body: some View {
        AppSurface(style: .inset) {
            Label(
                HomeCopy.feedUnavailable,
                systemImage: "arrow.triangle.2.circlepath"
            )
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityIdentifier("home.matches.unavailable")
    }
}
