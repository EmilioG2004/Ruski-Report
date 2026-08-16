//
//  TournamentPodsView.swift
//  Ruski Report
//

import SwiftUI

struct TournamentPodsView: View {
    let detail: TournamentDetail

    var body: some View {
        if detail.pods.isEmpty {
            TournamentEmptySectionView(
                title: "Pods are not available yet",
                systemImage: "square.grid.2x2"
            )
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(detail.pods.sorted { $0.sequence < $1.sequence }) { pod in
                    TournamentPodCard(detail: detail, pod: pod)
                }
            }
        }
    }
}

private struct TournamentPodCard: View {
    let detail: TournamentDetail
    let pod: TournamentPod

    var body: some View {
        let rows = detail.podStandingRows(for: pod)

        TournamentDetailCard {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(pod.name)
                        .font(.headline)

                    Text("\(rows.count) teams - \(pod.matchIds.count) matches")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 0)
            }

            if rows.isEmpty {
                Text("Teams pending")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 12) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 {
                            Divider()
                        }

                        TournamentPodStandingRowView(row: row)
                            .accessibilityIdentifier(
                                "tournament.pod.\(pod.id).standing.\(row.teamId)"
                            )
                    }
                }
                .accessibilityIdentifier("tournament.pod.\(pod.id).standings")
            }
        }
    }
}

private struct TournamentPodStandingRowView: View {
    let row: TournamentPodStandingRow

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Text(rankText)
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(rankColor)
                    .frame(width: 36, alignment: .leading)

                VStack(alignment: .leading, spacing: 3) {
                    Text(row.teamName)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(seedText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 0)
            }

            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 16) {
                    standingMetrics
                }

                VStack(alignment: .leading, spacing: 8) {
                    standingMetrics
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var standingMetrics: some View {
        TournamentPodStandingMetric(title: "Record", value: recordText)
        TournamentPodStandingMetric(title: "Cup Diff", value: differentialText)
        TournamentPodStandingMetric(title: "Shooting", value: shootingText)
    }

    private var rankText: String {
        guard let rank = row.rank else {
            return "-"
        }

        return "#\(rank)"
    }

    private var rankColor: Color {
        row.rank == nil ? .secondary : .accentColor
    }

    private var seedText: String {
        guard let seed = row.seed else {
            return "Seed TBD"
        }

        return "Seed \(seed)"
    }

    private var recordText: String {
        guard let wins = row.wins,
              let losses = row.losses else {
            return "-"
        }

        return "\(wins)-\(losses)"
    }

    private var differentialText: String {
        guard let cupDifferential = row.cupDifferential else {
            return "-"
        }

        return formatted(cupDifferential)
    }

    private var shootingText: String {
        guard let shootingPercentage = row.shootingPercentage else {
            return "-"
        }

        return "\(formatted(shootingPercentage * 100))%"
    }

    private func formatted(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...1)))
    }
}

private struct TournamentPodStandingMetric: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)

            Text(value)
                .font(.subheadline.weight(.medium).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(minWidth: 72, maxWidth: .infinity, alignment: .leading)
    }
}
