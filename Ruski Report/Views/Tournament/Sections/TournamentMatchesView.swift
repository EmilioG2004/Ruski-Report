//
//  TournamentMatchesView.swift
//  Ruski Report
//
//  Presents tournament games as status-based score feed sections and delegates
//  route ownership to the application navigation controller.
//

import SwiftUI

struct TournamentMatchesView: View {
    @EnvironmentObject private var navigation: AppNavigationController

    let detail: TournamentDetail

    var body: some View {
        if detail.matches.isEmpty {
            TournamentEmptySectionView(
                title: TournamentCopy.gamesUnavailable,
                systemImage: "sportscourt"
            )
        } else {
            VStack(alignment: .leading, spacing: AppLayout.sectionSpacing) {
                if !liveMatches.isEmpty {
                    matchGroup(
                        title: TournamentCopy.liveTitle,
                        subtitle: TournamentCopy.liveSubtitle,
                        matches: liveMatches
                    )
                }

                if !upcomingMatches.isEmpty {
                    matchGroup(
                        title: TournamentCopy.upcomingTitle,
                        subtitle: TournamentCopy.upcomingSubtitle,
                        matches: upcomingMatches
                    )
                }

                if !completedMatches.isEmpty {
                    matchGroup(
                        title: TournamentCopy.finalTitle,
                        subtitle: TournamentCopy.finalSubtitle,
                        matches: completedMatches
                    )
                }
            }
        }
    }

    private var liveMatches: [MatchPreview] {
        detail.matches.filter { $0.status == .inProgress }
    }

    private var upcomingMatches: [MatchPreview] {
        detail.matches.filter { $0.status == .scheduled }
    }

    private var completedMatches: [MatchPreview] {
        detail.matches.filter { $0.status == .final }
    }

    private func matchGroup(
        title: String,
        subtitle: String,
        matches: [MatchPreview]
    ) -> some View {
        VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
            AppSectionHeader(title, subtitle: subtitle, count: matches.count)

            ForEach(matches) { match in
                MatchScoreCard(
                    match: match,
                    teamName: detail.teamName,
                    context: TournamentMatchContextFormatter.label(
                        for: match,
                        in: detail
                    ),
                    accessibilityIdentifier: "tournament.match.\(match.id)"
                ) {
                    navigation.showMatch(match, in: detail)
                }
            }
        }
    }

}
