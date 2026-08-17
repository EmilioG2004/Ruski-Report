//
//  TournamentPodStandingMetric.swift
//  Ruski Report
//
//  Provides the shared label/value treatment used by responsive pod rows.
//

import SwiftUI

struct TournamentPodStandingMetric: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.microSpacing) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(AppVisualTokens.compactTextScale)

            Text(value)
                .font(.subheadline.weight(.medium).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(AppVisualTokens.compactTextScale)
        }
        .frame(
            minWidth: AppLayout.podMetricMinimumWidth,
            maxWidth: .infinity,
            alignment: .leading
        )
    }
}
