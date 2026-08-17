//
//  TournamentBracketMatchupCard.swift
//  Ruski Report
//
//  Presents a bracket matchup as a reusable, route-agnostic card with status,
//  participant, and progression information.
//

import SwiftUI

struct TournamentBracketMatchupCard: View {
    let matchup: TournamentBracketMatchup

    var body: some View {
        TournamentDetailCard {
            StatusMetadataLine(
                text: matchup.statusText,
                style: statusStyle,
                metadata: matchup.matchId ?? matchup.id
            )

            Text(matchup.title)
                .font(.subheadline.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)

            if matchup.slots.isEmpty {
                Text(TournamentCopy.matchupUnavailable)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: AppLayout.smallSpacing) {
                    ForEach(matchup.slots) { slot in
                        TournamentBracketTeamSlotView(slot: slot)
                    }
                }
            }

            if let progressionText = matchup.progressionText {
                progressionLabel(progressionText)
            }
        }
    }

    private func progressionLabel(_ text: String) -> some View {
        HStack(spacing: AppLayout.smallSpacing) {
            Image(systemName: "arrow.turn.down.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(
                    width: AppLayout.bracketProgressionIconWidth,
                    alignment: .leading
                )

            Text(text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .minimumScaleFactor(AppVisualTokens.compactTextScale)
        }
        .accessibilityIdentifier("tournament.bracket.progression")
    }

    private var statusStyle: StatusPill.Style {
        switch matchup.statusText.lowercased() {
        case "in progress", "active", "live": .live
        case "final", "completed": .final
        case "scheduled", "pending": .scheduled
        default: .neutral
        }
    }
}
