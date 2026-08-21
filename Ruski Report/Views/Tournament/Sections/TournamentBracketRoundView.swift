//
//  TournamentBracketRoundView.swift
//  Ruski Report
//
//  Renders one bracket round and exposes match navigation through an injected
//  action, keeping the bracket container independent of matchup details.
//

import SwiftUI

struct TournamentBracketRoundSectionView: View {
    let detail: TournamentDetail
    let section: TournamentBracketRoundSection
    let openMatch: (MatchPreview) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.smallSpacing) {
            HStack(alignment: .lastTextBaseline) {
                Text(section.name)
                    .font(.headline)

                Spacer(minLength: AppLayout.standardSpacing)

                Text(TournamentCopy.matchCount(section.matchups.count))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if section.matchups.isEmpty {
                TournamentDetailCard {
                    Text(TournamentCopy.matchesPending)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } else {
                VStack(spacing: AppLayout.compactSpacing) {
                    ForEach(section.matchups) { matchup in
                        matchupView(matchup)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func matchupView(_ matchup: TournamentBracketMatchup) -> some View {
        if let matchId = matchup.matchId,
           let match = detail.matchesById[matchId],
           matchup.isAvailable {
            Button {
                openMatch(match)
            } label: {
                TournamentBracketMatchupCard(matchup: matchup)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("tournament.bracket.match.\(matchup.id)")
        } else {
            TournamentBracketMatchupCard(matchup: matchup)
                .accessibilityIdentifier("tournament.bracket.match.\(matchup.id)")
        }
    }
}
