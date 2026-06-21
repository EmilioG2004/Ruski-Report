//
//  TournamentOverviewView.swift
//  Ruski Report
//

import SwiftUI

struct TournamentOverviewHeader: View {
    let detail: TournamentDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(detail.preview.name)
                        .font(.title.bold())

                    Text(detail.preview.formatSummary)
                        .font(.headline)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 12)

                StatusPill(text: detail.preview.status.displayName)
            }

            Text(detail.preview.locationName)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityIdentifier("tournament.header")
    }
}

struct TournamentOverviewView: View {
    let detail: TournamentDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TournamentDetailCard {
                TournamentMetricView(
                    title: "Season",
                    value: "\(detail.preview.year)",
                    systemImage: "calendar"
                )
                TournamentMetricView(
                    title: "Teams",
                    value: "\(detail.teams.count)",
                    systemImage: "person.3"
                )
                TournamentMetricView(
                    title: "Matches",
                    value: "\(detail.matches.count)",
                    systemImage: "sportscourt"
                )
                TournamentMetricView(
                    title: "Bracket Rounds",
                    value: "\(detail.bracket?.rounds.count ?? 0)",
                    systemImage: "rectangle.grid.2x2"
                )
            }
        }
        .accessibilityIdentifier("tournament.overview")
    }
}
