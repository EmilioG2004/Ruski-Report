//
//  MatchScoreHeaderView.swift
//  Ruski Report
//

import SwiftUI

struct MatchScoreHeaderView: View {
    let screen: MatchDetailScreen
    let routeContext: MatchRouteContext

    var body: some View {
        AppSurface {
            StatusMetadataLine(
                status: screen.match.preview.status,
                metadata: screen.match.preview.currentPhaseLabel
            )

            Text(routeContext.title)
                .font(.title2.weight(.bold))
                .fixedSize(horizontal: false, vertical: true)

            Divider()

            VStack(spacing: 12) {
                ForEach(screen.match.preview.participants, id: \.teamId) { participant in
                    MatchParticipantScoreRow(
                        name: routeContext.teamName(for: participant.teamId) ??
                            participant.teamId,
                        score: scoreText(for: participant),
                        isWinner: isWinner(participant)
                    )
                }
            }
            .accessibilityIdentifier("match.scoreHeader")
        }
    }

    private func scoreText(for participant: MatchParticipant) -> String {
        if let score = participant.score {
            return "\(score)"
        }

        if let score = screen.match.preview.score?.participants.first(
            where: { $0.teamId == participant.teamId }
        )?.score {
            return "\(score)"
        }

        return "-"
    }

    private func isWinner(_ participant: MatchParticipant) -> Bool {
        screen.match.preview.score?.winnerTeamId == participant.teamId
    }
}

private struct MatchParticipantScoreRow: View {
    let name: String
    let score: String
    let isWinner: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(name)
                .font(.body.weight(isWinner ? .semibold : .medium))
                .fixedSize(horizontal: false, vertical: true)
                .layoutPriority(1)

            Spacer(minLength: 8)

            if isWinner {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color.appFinal)
                    .accessibilityLabel("Winner")
            }

            Text(score)
                .font(.title2.weight(.bold).monospacedDigit())
                .foregroundStyle(isWinner ? Color.appFinal : Color.primary)
        }
        .accessibilityElement(children: .combine)
    }
}
