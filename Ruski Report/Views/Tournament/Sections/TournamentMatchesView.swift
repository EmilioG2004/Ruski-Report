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
        }
    }
}

private struct TournamentMatchCard: View {
    let detail: TournamentDetail
    let match: MatchPreview

    var body: some View {
        TournamentDetailCard {
            StatusMetadataLine(
                status: match.status,
                metadata: match.currentPhaseLabel
            )

            Text(detail.participantsLabel(for: match))
                .font(.headline)
                .fixedSize(horizontal: false, vertical: true)

            if let score = detail.scoreLabel(for: match) {
                Text(score)
                    .font(.title3.weight(.bold).monospacedDigit())
            }

            Divider()

            HStack {
                Text("Match details")
                    .font(.subheadline.weight(.semibold))

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.subheadline.weight(.semibold))
                    .accessibilityHidden(true)
            }
            .foregroundStyle(Color.accentColor)
        }
    }
}
