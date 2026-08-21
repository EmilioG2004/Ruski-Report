//
//  TournamentBracketTeamSlotView.swift
//  Ruski Report
//
//  Displays one seeded bracket participant with winner emphasis while keeping
//  matchup cards compact and consistent.
//

import SwiftUI

struct TournamentBracketTeamSlotView: View {
    let slot: TournamentBracketTeamSlot

    var body: some View {
        HStack(spacing: AppLayout.compactSpacing) {
            Text(seedText)
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: AppLayout.bracketSeedWidth, alignment: .leading)

            Text(slot.teamName)
                .font(.subheadline.weight(slot.isWinner ? .semibold : .regular))
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: AppLayout.smallSpacing)

            Text(scoreText)
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .frame(minWidth: AppLayout.bracketScoreWidth, alignment: .trailing)

            if slot.isWinner {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color.appFinal)
                    .accessibilityLabel(AppSportsCopy.winner)
            }
        }
        .padding(.horizontal, AppLayout.compactSpacing)
        .padding(.vertical, AppLayout.smallSpacing)
        .background(winnerBackground)
        .clipShape(
            RoundedRectangle(
                cornerRadius: AppLayout.smallSpacing,
                style: .continuous
            )
        )
    }

    private var winnerBackground: Color {
        slot.isWinner
            ? Color.accentColor.opacity(AppVisualTokens.subtleTintOpacity)
            : Color.clear
    }

    private var seedText: String {
        slot.seed.map(AppSportsCopy.seed) ?? "Seed -"
    }

    private var scoreText: String {
        slot.score.map(String.init) ?? "-"
    }
}
