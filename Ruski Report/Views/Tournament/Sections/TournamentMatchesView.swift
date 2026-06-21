//
//  TournamentMatchesView.swift
//  Ruski Report
//

import SwiftUI

struct TournamentMatchesView: View {
    let detail: TournamentDetail

    var body: some View {
        if detail.matches.isEmpty {
            TournamentEmptySectionView(
                title: "Matches are not available yet",
                systemImage: "sportscourt"
            )
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(detail.matches) { match in
                    TournamentMatchCard(detail: detail, match: match)
                }
            }
            .accessibilityIdentifier("tournament.matches")
        }
    }
}

private struct TournamentMatchCard: View {
    let detail: TournamentDetail
    let match: MatchPreview

    var body: some View {
        TournamentDetailCard {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(detail.participantsLabel(for: match))
                        .font(.headline)

                    if let phase = match.currentPhaseLabel {
                        Text(phase)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer(minLength: 12)

                StatusPill(text: match.status.displayName)
            }

            if let score = detail.scoreLabel(for: match) {
                Text(score)
                    .font(.subheadline.weight(.semibold))
            }
        }
    }
}
