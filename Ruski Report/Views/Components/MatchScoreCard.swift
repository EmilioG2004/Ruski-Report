//
//  MatchScoreCard.swift
//  Ruski Report
//
//  Renders the canonical scheduled, live, and final game summary used by every
//  score feed. Navigation remains an injected action to keep the view reusable.
//

import SwiftUI

struct MatchScoreCard: View {
    let match: MatchPreview
    let teamName: (String) -> String
    let context: String?
    let actionTitle: String
    let accessibilityIdentifier: String
    let action: () -> Void

    init(
        match: MatchPreview,
        teamName: @escaping (String) -> String,
        context: String? = nil,
        actionTitle: String = AppSportsCopy.gameCenter,
        accessibilityIdentifier: String,
        action: @escaping () -> Void
    ) {
        self.match = match
        self.teamName = teamName
        self.context = context
        self.actionTitle = actionTitle
        self.accessibilityIdentifier = accessibilityIdentifier
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            AppSurface(style: .elevated) {
                StatusMetadataLine(
                    status: match.status,
                    metadata: match.currentPhaseLabel ?? context
                )

                VStack(spacing: AppLayout.smallSpacing) {
                    ForEach(match.participants, id: \.teamId) { participant in
                        MatchScoreTeamRow(
                            participant: participant,
                            name: teamName(participant.teamId),
                            score: score(for: participant),
                            isWinner: winnerTeamID == participant.teamId
                        )
                    }

                    if match.participants.isEmpty {
                        Text(AppSportsCopy.teamsPending)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, AppLayout.smallSpacing)
                    }
                }

                MatchScoreCardAction(
                    context: match.currentPhaseLabel == nil ? nil : context,
                    title: actionTitle
                )
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
    }

    private var winnerTeamID: String? {
        match.score?.winnerTeamId ?? match.participants.first {
            $0.result == "win"
        }?.teamId
    }

    private func score(for participant: MatchParticipant) -> Int? {
        participant.score ?? match.score?.participants.first {
            $0.teamId == participant.teamId
        }?.score
    }
}

private struct MatchScoreTeamRow: View {
    let participant: MatchParticipant
    let name: String
    let score: Int?
    let isWinner: Bool

    var body: some View {
        HStack(spacing: AppLayout.standardSpacing) {
            TeamMonogramView(name: name)

            VStack(alignment: .leading, spacing: AppLayout.microSpacing) {
                Text(name)
                    .font(.subheadline.weight(isWinner ? .bold : .semibold))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                if let seed = participant.seed {
                    Text(AppSportsCopy.seed(seed))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .layoutPriority(1)

            Spacer(minLength: AppLayout.smallSpacing)

            if isWinner {
                Image(systemName: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(Color.appFinal)
                    .accessibilityLabel(AppSportsCopy.winner)
            }

            Text(score.map(String.init) ?? "–")
                .font(.title2.weight(.bold).monospacedDigit())
                .foregroundStyle(isWinner ? Color.appFinal : Color.primary)
                .frame(minWidth: AppLayout.statusIconSize, alignment: .trailing)
        }
        .frame(minHeight: AppLayout.scoreRowHeight)
        .accessibilityElement(children: .combine)
    }
}

private struct MatchScoreCardAction: View {
    let context: String?
    let title: String

    var body: some View {
        HStack(spacing: AppLayout.smallSpacing) {
            if let context {
                Text(context)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: AppLayout.smallSpacing)
            Text(title).font(.caption.weight(.bold))
            Image(systemName: "chevron.right")
                .font(.caption.weight(.bold))
                .accessibilityHidden(true)
        }
        .foregroundStyle(Color.appBrand)
    }
}
