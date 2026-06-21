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
            .accessibilityIdentifier("tournament.pods")
        }
    }
}

private struct TournamentPodCard: View {
    let detail: TournamentDetail
    let pod: TournamentPod

    var body: some View {
        TournamentDetailCard {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(pod.name)
                        .font(.headline)

                    Text("\(pod.teamIds.count) teams - \(pod.matchIds.count) matches")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 0)
            }

            if pod.teamIds.isEmpty {
                Text("Teams pending")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(pod.teamIds, id: \.self) { teamId in
                        Text(detail.teamName(for: teamId))
                            .font(.subheadline.weight(.medium))
                    }
                }
            }
        }
    }
}
