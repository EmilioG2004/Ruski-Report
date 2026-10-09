//
//  PublicMatchScoreCard.swift
//  Ruski Report
//
//  Renders a canonical match summary using the participant identity embedded
//  in that projection version. No tournament-route name cache is consulted.
//

import SwiftUI

struct PublicMatchScoreCard: View {
    let match: PublicMatchSummary
    let accessibilityIdentifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            AppSurface(style: .elevated) {
                StatusMetadataLine(
                    text: match.status.displayName,
                    style: match.status.pillStyle,
                    metadata: match.scheduleDisplay
                )
                .accessibilityIdentifier(
                    "\(accessibilityIdentifier).status.\(match.status.rawValue)"
                )

                VStack(spacing: AppLayout.smallSpacing) {
                    ForEach(match.participants, id: \.side) { participant in
                        PublicMatchScoreTeamRow(
                            participant: participant,
                            scoreAvailability: match.scoreAvailability,
                            isWinner: match.winner?.id == participant.team.id
                        )
                    }
                }

                HStack(spacing: AppLayout.smallSpacing) {
                    Text(match.contextDisplay)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)

                    Spacer(minLength: AppLayout.smallSpacing)

                    Text(match.scoreAvailability.displayName)
                        .font(.caption.weight(.semibold))
                        .multilineTextAlignment(.trailing)
                        .accessibilityIdentifier(
                            "\(accessibilityIdentifier).availability.\(match.scoreAvailability.rawValue)"
                        )

                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.bold))
                        .accessibilityHidden(true)
                }
                .foregroundStyle(Color.appBrand)
            }
            .overlay(alignment: .leading) {
                if match.status == .inProgress {
                    Capsule()
                        .fill(Color.appLive)
                        .frame(width: AppLayout.liveIndicatorWidth)
                        .padding(.vertical, AppLayout.contentSpacing)
                }
            }
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        .accessibilityIdentifier(accessibilityIdentifier)
        .accessibilityHint("Opens the official game detail")
    }
}

private struct PublicMatchScoreTeamRow: View {
    let participant: PublicMatchParticipant
    let scoreAvailability: PublicScoreAvailability
    let isWinner: Bool

    var body: some View {
        HStack(spacing: AppLayout.standardSpacing) {
            TeamMonogramView(name: participant.team.name)

            VStack(alignment: .leading, spacing: AppLayout.microSpacing) {
                Text(participant.team.name)
                    .font(.subheadline.weight(isWinner ? .bold : .semibold))
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: AppLayout.smallSpacing) {
                    if let seed = participant.seed {
                        Text(AppSportsCopy.seed(seed))
                    }
                    if let resultText {
                        Text(resultText)
                    }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
            .layoutPriority(1)

            Spacer(minLength: AppLayout.smallSpacing)

            if isWinner {
                Image(systemName: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(Color.appFinal)
                    .accessibilityLabel(AppSportsCopy.winner)
            }

            Text(scoreText)
                .font(.title2.weight(.bold).monospacedDigit())
                .foregroundStyle(isWinner ? Color.appFinal : Color.primary)
                .frame(minWidth: AppLayout.statusIconSize, alignment: .trailing)
        }
        .frame(minHeight: AppLayout.scoreRowHeight)
        .accessibilityElement(children: .combine)
    }

    private var scoreText: String {
        switch scoreAvailability {
        case .partial, .complete:
            participant.score.map(String.init) ?? "–"
        case .notStarted, .unrecorded, .notApplicable:
            "–"
        }
    }

    private var resultText: String? {
        switch participant.result {
        case .win: "Winner"
        case .loss: "Loss"
        case .tie: "Tie"
        case .cancelled: "Cancelled"
        case .forfeited: "Forfeit"
        case nil: nil
        }
    }
}
