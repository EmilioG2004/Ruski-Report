//
//  TournamentBracketView.swift
//  Ruski Report
//

import SwiftUI

struct TournamentBracketView: View {
    @EnvironmentObject private var navigation: AppNavigationController

    let detail: TournamentDetail

    var body: some View {
        let sections = detail.bracketRoundSections()

        if sections.isEmpty {
            TournamentEmptySectionView(
                title: "Bracket is not available yet",
                systemImage: "rectangle.grid.2x2"
            )
        } else {
            ScrollView(.horizontal, showsIndicators: true) {
                LazyHStack(alignment: .top, spacing: 16) {
                    ForEach(sections) { section in
                        TournamentBracketRoundSectionView(
                            detail: detail,
                            section: section,
                            openMatch: { match in
                                navigation.showMatch(match, in: detail)
                            }
                        )
                        .frame(width: AppLayout.bracketRoundWidth)
                    }
                }
                .padding(.bottom, 8)
            }
            .accessibilityIdentifier("tournament.bracket")
        }
    }
}

private struct TournamentBracketRoundSectionView: View {
    let detail: TournamentDetail
    let section: TournamentBracketRoundSection
    let openMatch: (MatchPreview) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .lastTextBaseline) {
                Text(section.name)
                    .font(.headline)

                Spacer(minLength: 12)

                Text(matchCountText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if section.matchups.isEmpty {
                TournamentDetailCard {
                    Text("Matches pending")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } else {
                VStack(spacing: 10) {
                    ForEach(section.matchups) { matchup in
                        if let matchId = matchup.matchId,
                           let match = detail.matchesById[matchId],
                           matchup.isAvailable {
                            Button {
                                openMatch(match)
                            } label: {
                                TournamentBracketMatchupCard(matchup: matchup)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier(
                                "tournament.bracket.match.\(matchup.id)"
                            )
                        } else {
                            TournamentBracketMatchupCard(matchup: matchup)
                                .accessibilityIdentifier(
                                    "tournament.bracket.match.\(matchup.id)"
                                )
                        }
                    }
                }
            }
        }
    }

    private var matchCountText: String {
        let count = section.matchups.count

        if count == 1 {
            return "1 match"
        }

        return "\(count) matches"
    }
}

private struct TournamentBracketMatchupCard: View {
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
                Text("Match summary unavailable")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 8) {
                    ForEach(matchup.slots) { slot in
                        TournamentBracketTeamSlotView(slot: slot)
                    }
                }
            }

            if let progressionText = matchup.progressionText {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.turn.down.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.accentColor)
                        .frame(width: 18, alignment: .leading)

                    Text(progressionText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.82)
                }
                .accessibilityIdentifier("tournament.bracket.progression")
            }
        }
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

private struct TournamentBracketTeamSlotView: View {
    let slot: TournamentBracketTeamSlot

    var body: some View {
        HStack(spacing: 10) {
            Text(seedText)
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 44, alignment: .leading)

            Text(slot.teamName)
                .font(.subheadline.weight(slot.isWinner ? .semibold : .regular))
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 8)

            Text(scoreText)
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .frame(minWidth: 28, alignment: .trailing)

            if slot.isWinner {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color.appFinal)
                    .accessibilityLabel("Winner")
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(slot.isWinner ? Color.accentColor.opacity(0.12) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var seedText: String {
        guard let seed = slot.seed else {
            return "Seed -"
        }

        return "Seed \(seed)"
    }

    private var scoreText: String {
        guard let score = slot.score else {
            return "-"
        }

        return "\(score)"
    }
}
