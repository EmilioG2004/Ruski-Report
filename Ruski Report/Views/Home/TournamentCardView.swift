//
//  TournamentCardView.swift
//  Ruski Report
//
//  Presents the active tournament as the primary branded route from the Home
//  score feed.
//

import SwiftUI

struct TournamentCardView: View {
    let tournament: TournamentPreview
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: AppLayout.largeSpacing) {
                HStack(spacing: AppLayout.standardSpacing) {
                    Label(tournament.status.displayName, systemImage: "trophy.fill")
                        .font(.caption.weight(.bold))
                        .padding(.horizontal, AppLayout.pillHorizontalPadding)
                        .padding(.vertical, AppLayout.pillVerticalPadding)
                        .background(
                            Color.white.opacity(AppVisualTokens.statusPillOnBrandOpacity)
                        )
                        .clipShape(Capsule())

                    Spacer(minLength: AppLayout.smallSpacing)

                    Text(verbatim: String(tournament.year))
                        .font(.subheadline.weight(.bold).monospacedDigit())
                }

                Text(tournament.name)
                    .font(.title2.weight(.black))
                    .fixedSize(horizontal: false, vertical: true)

                Label(tournament.locationName, systemImage: "mappin.and.ellipse")
                    .font(.subheadline)
                    .foregroundStyle(
                        Color.white.opacity(AppVisualTokens.secondaryOnBrandOpacity)
                    )
                    .fixedSize(horizontal: false, vertical: true)

                Text(tournament.formatSummary)
                    .font(.subheadline)
                    .foregroundStyle(
                        Color.white.opacity(AppVisualTokens.secondaryOnBrandOpacity)
                    )
                    .fixedSize(horizontal: false, vertical: true)

                Rectangle()
                    .fill(
                        Color.white.opacity(AppVisualTokens.dividerOnBrandOpacity)
                    )
                    .frame(height: AppLayout.hairlineWidth)

                HStack {
                    Label(featuredMatchText, systemImage: "sportscourt")
                        .font(.headline)

                    Spacer()

                    Image(systemName: "arrow.right.circle.fill")
                        .font(.title3)
                        .accessibilityHidden(true)
                }
                .font(.subheadline.weight(.bold))
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
            .shadow(
                color: Color.appBrand.opacity(AppVisualTokens.heroShadowOpacity),
                radius: AppVisualTokens.heroShadowRadius,
                y: AppVisualTokens.heroShadowY
            )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("home.tournamentCard")
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isButton)
    }

    private var featuredMatchText: String {
        HomeCopy.featuredGameCount(tournament.featuredMatchCount)
    }
}
