//
//  TournamentMatchesView.swift
//  Ruski Report
//

import SwiftUI

struct TournamentMatchesView: View {
    @EnvironmentObject private var navigation: AppNavigationController

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
                    Button {
                        navigation.showMatch(match, in: detail)
                    } label: {
                        TournamentMatchCard(detail: detail, match: match)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("tournament.match.\(match.id)")
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
