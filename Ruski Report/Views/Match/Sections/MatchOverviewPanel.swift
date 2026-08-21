//
//  MatchOverviewPanel.swift
//  Ruski Report
//
//  Composes the game snapshot and box score without owning navigation or
//  scrolling, making the panel reusable in other game-center presentations.
//

import SwiftUI

struct MatchOverviewPanel: View {
    let screen: MatchDetailScreen

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.sectionSpacing) {
            if screen.isScoreUnavailable {
                MatchScoreAvailabilityNotice()
            }

            VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
                AppSectionHeader(
                    MatchCopy.overviewTitle,
                    subtitle: MatchCopy.overviewSubtitle
                )

                LazyVGrid(columns: metricColumns, spacing: AppLayout.compactSpacing) {
                    AppMetricTile(
                        title: MatchCopy.statusMetric,
                        value: screen.match.preview.status.displayName,
                        systemImage: "dot.radiowaves.left.and.right"
                    )
                    AppMetricTile(
                        title: MatchCopy.phaseMetric,
                        value: screen.match.preview.currentPhaseLabel ?? MatchCopy.notStarted,
                        systemImage: "flag.checkered"
                    )
                    AppMetricTile(
                        title: MatchCopy.playsMetric,
                        value: "\(screen.match.events.count)",
                        systemImage: "list.number"
                    )
                    AppMetricTile(
                        title: MatchCopy.commentsMetric,
                        value: "\(screen.match.commentsSummary?.count ?? 0)",
                        systemImage: "text.bubble"
                    )
                }
            }
            .accessibilityIdentifier("match.overview")

            MatchBoxScoreView(screen: screen)
        }
    }

    private var metricColumns: [GridItem] {
        [
            GridItem(.flexible(), spacing: AppLayout.compactSpacing),
            GridItem(.flexible(), spacing: AppLayout.compactSpacing)
        ]
    }
}
