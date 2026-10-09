//
//  TournamentOverviewView.swift
//  Ruski Report
//
//  Provides tournament identity and a compact metadata snapshot using shared
//  hero and metric primitives.
//

import SwiftUI

struct TournamentOverviewHeader: View {
    let detail: TournamentDetail

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.contentSpacing) {
            HStack(spacing: AppLayout.compactSpacing) {
                Text(TournamentCopy.officialTournament)
                    .font(.caption2.weight(.black))
                    .tracking(AppVisualTokens.overlineTracking)

                Spacer(minLength: AppLayout.smallSpacing)

                Label(
                    detail.preview.status.displayName,
                    systemImage: detail.preview.status == .active
                        ? "dot.radiowaves.left.and.right"
                        : "trophy.fill"
                )
                .font(.caption.weight(.bold))
                .padding(.horizontal, AppLayout.pillHorizontalPadding)
                .padding(.vertical, AppLayout.pillVerticalPadding)
                .background(
                    Color.white.opacity(AppVisualTokens.statusPillOnBrandOpacity)
                )
                .clipShape(Capsule())
            }

            Text(detail.preview.name)
                .font(.title.weight(.black))
                .fixedSize(horizontal: false, vertical: true)

            Text(detail.preview.formatSummary)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(
                    Color.white.opacity(AppVisualTokens.secondaryOnBrandOpacity)
                )
                .fixedSize(horizontal: false, vertical: true)

            Label(detail.preview.locationName, systemImage: "mappin.and.ellipse")
                .font(.subheadline)
                .foregroundStyle(
                    Color.white.opacity(AppVisualTokens.secondaryOnBrandOpacity)
                )
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: AppLayout.largeSpacing) {
                Label("\(detail.teams.count) teams", systemImage: "person.3.fill")
                Label("\(detail.matches.count) games", systemImage: "sportscourt.fill")
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(
                Color.white.opacity(AppVisualTokens.strongOnBrandOpacity)
            )
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
        .accessibilityIdentifier("tournament.header")
    }
}

struct TournamentOverviewView: View {
    let detail: TournamentDetail

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
            AppSectionHeader(
                TournamentCopy.snapshotTitle,
                subtitle: TournamentCopy.snapshotSubtitle
            )

            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: AppLayout.compactSpacing),
                    GridItem(.flexible(), spacing: AppLayout.compactSpacing)
                ],
                spacing: AppLayout.compactSpacing
            ) {
                AppMetricTile(
                    title: "Season",
                    value: "\(detail.preview.year)",
                    systemImage: "calendar"
                )
                AppMetricTile(
                    title: "Teams",
                    value: "\(detail.teams.count)",
                    systemImage: "person.3"
                )
                AppMetricTile(
                    title: TournamentCopy.gamesMetric,
                    value: "\(detail.matches.count)",
                    systemImage: "sportscourt"
                )
                AppMetricTile(
                    title: "Bracket Rounds",
                    value: "\(detail.bracket?.rounds.count ?? 0)",
                    systemImage: "rectangle.grid.2x2"
                )
            }
        }
        .accessibilityIdentifier("tournament.overview")
    }
}
