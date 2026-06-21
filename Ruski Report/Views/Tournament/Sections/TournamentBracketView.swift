//
//  TournamentBracketView.swift
//  Ruski Report
//

import SwiftUI

struct TournamentBracketView: View {
    let detail: TournamentDetail

    var body: some View {
        if let bracket = detail.bracket, !bracket.rounds.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(bracket.rounds.sorted { $0.sequence < $1.sequence }) { round in
                    TournamentBracketRoundCard(detail: detail, round: round)
                }
            }
            .accessibilityIdentifier("tournament.bracket")
        } else {
            TournamentEmptySectionView(
                title: "Bracket is not available yet",
                systemImage: "rectangle.grid.2x2"
            )
        }
    }
}

private struct TournamentBracketRoundCard: View {
    let detail: TournamentDetail
    let round: BracketRound

    var body: some View {
        TournamentDetailCard {
            Text(round.name)
                .font(.headline)

            if round.matchIds.isEmpty {
                Text("Matches pending")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(round.matchIds, id: \.self) { matchId in
                        Text(matchLabel(matchId))
                            .font(.subheadline)
                    }
                }
            }
        }
    }

    private func matchLabel(_ matchId: MatchPreview.ID) -> String {
        guard let match = detail.matchesById[matchId] else {
            return matchId
        }

        return detail.participantsLabel(for: match)
    }
}
