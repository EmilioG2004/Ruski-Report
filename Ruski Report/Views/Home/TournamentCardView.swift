//
//  TournamentCardView.swift
//  Ruski Report
//

import SwiftUI

struct TournamentCardView: View {
    let tournament: TournamentPreview
    let action: () -> Void

    var body: some View {
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
                Label(
                    "\(tournament.featuredMatchCount) featured matches",
                    systemImage: "sportscourt"
                )
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)

            Button(action: action) {
                Label("Open Tournament", systemImage: "arrow.right.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("home.openTournament")
        }
        .padding(20)
        .background(Color.appSecondaryGroupedBackground)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color.appSeparator, lineWidth: 0.5)
        }
        .accessibilityElement(children: .contain)
    }
}
