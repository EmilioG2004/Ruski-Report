//
//  TournamentCardView.swift
//  Ruski Report
//

import SwiftUI

struct TournamentCardView: View {
    let tournament: TournamentPreview
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            AppSurface {
                HStack(spacing: 12) {
                    StatusPill(status: tournament.status)

                    Spacer(minLength: 8)

                    Text(tournament.year.formatted())
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .foregroundStyle(.secondary)
                }

                Text(tournament.name)
                    .font(.title2.bold())
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)

                Label(tournament.locationName, systemImage: "mappin.and.ellipse")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                Text(tournament.formatSummary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                Divider()

                HStack {
                    Label(featuredMatchText, systemImage: "sportscourt")
                        .font(.headline)

                    Spacer()

                    Image(systemName: "arrow.right.circle.fill")
                        .font(.title3)
                        .accessibilityHidden(true)
                }
                .foregroundStyle(Color.accentColor)
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("home.tournamentCard")
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isButton)
    }

    private var featuredMatchText: String {
        let count = tournament.featuredMatchCount
        return "\(count) featured \(count == 1 ? "match" : "matches")"
    }
}
