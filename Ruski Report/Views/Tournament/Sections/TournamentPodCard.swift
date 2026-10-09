//
//  TournamentPodCard.swift
//  Ruski Report
//
//  Adapts a tournament pod and its derived standings into a compact surface.
//

import SwiftUI

struct TournamentPodCard: View {
    let detail: TournamentDetail
    let pod: TournamentPod

    var body: some View {
        let rows = detail.podStandingRows(for: pod)

        TournamentDetailCard {
            VStack(alignment: .leading, spacing: AppLayout.microSpacing) {
                Text(pod.name)
                    .font(.headline)

                Text(
                    TournamentCopy.podSummary(
                        teamCount: rows.count,
                        matchCount: pod.matchIds.count
                    )
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            if rows.isEmpty {
                Text(TournamentCopy.teamsPending)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: AppLayout.standardSpacing) {
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
