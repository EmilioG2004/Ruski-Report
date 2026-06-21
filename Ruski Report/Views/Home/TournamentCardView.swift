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
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(tournament.name)
                            .font(.title2.bold())
                            .foregroundStyle(.primary)

                        Text(tournament.locationName)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    Spacer(minLength: 12)

                    StatusPill(text: tournament.status.displayName)
                }

                VStack(alignment: .leading, spacing: 10) {
                    Label(tournament.formatSummary, systemImage: "trophy")
                    Label("\(tournament.year) season", systemImage: "calendar")
                    Label(featuredMatchText, systemImage: "sportscourt")
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)

                HStack {
                    Label("Open Tournament", systemImage: "arrow.right.circle.fill")
                        .font(.headline)

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                .foregroundStyle(Color.accentColor)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.appSecondaryGroupedBackground)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color.appSeparator, lineWidth: 0.5)
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
