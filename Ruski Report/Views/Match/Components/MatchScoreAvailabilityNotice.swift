//
//  MatchScoreAvailabilityNotice.swift
//  Ruski Report
//
//  Explains bracket-only results without presenting missing source data as a
//  loading failure or inventing scores that were never recorded.
//

import SwiftUI

struct MatchScoreAvailabilityNotice: View {
    var body: some View {
        AppSurface(style: .inset) {
            Label(
                AppSportsCopy.scoreNotRecorded,
                systemImage: "doc.badge.ellipsis"
            )
            .font(.subheadline.weight(.semibold))

            Text(AppSportsCopy.scoreNotRecordedMessage)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityIdentifier("match.scoreUnavailable")
    }
}
