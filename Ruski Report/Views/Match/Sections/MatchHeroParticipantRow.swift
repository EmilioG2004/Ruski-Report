//
//  MatchHeroParticipantRow.swift
//  Ruski Report
//
//  Renders one game-center participant with scalable team identity, optional
//  seeding, winner state, and a monospaced score.
//

import SwiftUI

struct MatchHeroParticipantRow: View {
    let name: String
    let seed: Int?
    let score: String
    let isWinner: Bool

    var body: some View {
        HStack(spacing: AppLayout.standardSpacing) {
            TeamMonogramView(
                name: name,
                size: AppLayout.heroTeamMonogramSize,
                onBrand: true
            )

            VStack(alignment: .leading, spacing: AppLayout.microSpacing) {
                Text(name)
                    .font(.body.weight(isWinner ? .bold : .semibold))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                if let seed {
                    Text(AppSportsCopy.seed(seed))
                        .font(.caption2)
                        .foregroundStyle(
                            Color.white.opacity(AppVisualTokens.monogramGradientEndOpacity)
                        )
                }
            }
            .layoutPriority(1)

            Spacer(minLength: AppLayout.smallSpacing)

            if isWinner {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color.white)
                    .accessibilityLabel(AppSportsCopy.winner)
            }

            Text(score)
                .font(.title.weight(.black).monospacedDigit())
                .foregroundStyle(Color.white)
                .frame(
                    minWidth: AppLayout.matchHeaderScoreWidth,
                    alignment: .trailing
                )
        }
        .padding(.vertical, AppLayout.microSpacing)
        .accessibilityElement(children: .combine)
    }
}
