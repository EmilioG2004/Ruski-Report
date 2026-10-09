//
//  TournamentPodStandingRowView.swift
//  Ruski Report
//
//  Displays a responsive standings row and centralizes its optional-value
//  formatting so incomplete tournament data remains explicit.
//

import SwiftUI

struct TournamentPodStandingRowView: View {
    let row: TournamentPodStandingRow

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.compactSpacing) {
            teamIdentity

            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: AppLayout.largeSpacing) {
                    standingMetrics
                }

                VStack(alignment: .leading, spacing: AppLayout.smallSpacing) {
                    standingMetrics
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var teamIdentity: some View {
        HStack(alignment: .top, spacing: AppLayout.compactSpacing) {
            Text(rankText)
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(row.rank == nil ? Color.secondary : Color.accentColor)
                .frame(width: AppLayout.podRankWidth, alignment: .leading)

            VStack(alignment: .leading, spacing: AppLayout.microSpacing) {
                Text(row.teamName)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)
                    .minimumScaleFactor(AppVisualTokens.compactTextScale)
                    .fixedSize(horizontal: false, vertical: true)

                Text(seedText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private var standingMetrics: some View {
        TournamentPodStandingMetric(title: "Record", value: recordText)
        TournamentPodStandingMetric(title: "Cup Diff", value: differentialText)
        TournamentPodStandingMetric(title: "Shooting", value: shootingText)
    }

    private var rankText: String {
        row.rank.map { "#\($0)" } ?? "-"
    }

    private var seedText: String {
        row.seed.map { "Seed \($0)" } ?? "Seed TBD"
    }

    private var recordText: String {
        guard let wins = row.wins, let losses = row.losses else { return "-" }
        return "\(wins)-\(losses)"
    }

    private var differentialText: String {
        row.cupDifferential.map(formatted) ?? "-"
    }

    private var shootingText: String {
        guard let percentage = row.shootingPercentage else { return "-" }
        return "\(formatted(percentage * 100))%"
    }

    private func formatted(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...1)))
    }
}
