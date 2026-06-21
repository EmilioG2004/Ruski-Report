//
//  TournamentStatsView.swift
//  Ruski Report
//

import SwiftUI

struct TournamentStatsView: View {
    let detail: TournamentDetail

    var body: some View {
        if detail.standings.isEmpty {
            TournamentEmptySectionView(
                title: "Stats are not available yet",
                systemImage: "chart.bar"
            )
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(detail.standings.sorted { $0.rank < $1.rank }) { standing in
                    TournamentStandingCard(detail: detail, standing: standing)
                }
            }
            .accessibilityIdentifier("tournament.stats")
        }
    }
}

private struct TournamentStandingCard: View {
    let detail: TournamentDetail
    let standing: PodStanding

    var body: some View {
        TournamentDetailCard {
            HStack(alignment: .top) {
                Text("#\(standing.rank)")
                    .font(.headline)
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 42, alignment: .leading)

                VStack(alignment: .leading, spacing: 8) {
                    Text(detail.teamName(for: standing.teamId))
                        .font(.headline)

                    HStack(spacing: 16) {
                        stat("Record", "\(standing.wins)-\(standing.losses)")
                        if let points = standing.points {
                            stat("Points", "\(points)")
                        }
                        if let differential = standing.cupDifferential {
                            stat("Differential", formatted(differential))
                        }
                    }

                    if let percentage = standing.shootingPercentage {
                        stat("Shooting", "\(formatted(percentage * 100))%")
                    }
                }

                Spacer(minLength: 0)
            }
        }
    }

    private func stat(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.weight(.medium))
        }
    }

    private func formatted(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...1)))
    }
}
