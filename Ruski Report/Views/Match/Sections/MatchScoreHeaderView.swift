//
//  MatchScoreHeaderView.swift
//  Ruski Report
//
//  Presents persistent game context while delegating participant identity to a
//  reusable row component.
//

import SwiftUI

struct MatchScoreHeaderView: View {
    let screen: MatchDetailScreen
    let routeContext: MatchRouteContext

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.largeSpacing) {
            HStack(alignment: .center, spacing: AppLayout.compactSpacing) {
                Label(
                    statusText,
                    systemImage: statusSystemImage
                )
                .font(.caption.weight(.bold))
                .padding(.horizontal, AppLayout.pillHorizontalPadding)
                .padding(.vertical, AppLayout.pillVerticalPadding)
                .background(statusBackground)
                .clipShape(Capsule())

                Spacer(minLength: AppLayout.smallSpacing)

                if let phase = screen.match.preview.currentPhaseLabel {
                    Text(phase)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(
                            Color.white.opacity(AppVisualTokens.secondaryOnBrandOpacity)
                        )
                        .multilineTextAlignment(.trailing)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Text(MatchCopy.gameCenter)
                .font(.caption2.weight(.black))
                .tracking(AppVisualTokens.overlineTracking)
                .foregroundStyle(
                    Color.white.opacity(AppVisualTokens.monogramGradientEndOpacity)
                )

            VStack(spacing: AppLayout.smallSpacing) {
                ForEach(screen.match.preview.participants, id: \.teamId) { participant in
                    MatchHeroParticipantRow(
                        name: routeContext.teamName(for: participant.teamId) ??
                            participant.teamId,
                        seed: participant.seed,
                        score: scoreText(for: participant),
                        isWinner: isWinner(participant)
                    )
                }
            }
            .accessibilityIdentifier("match.scoreHeader")

            Text(routeContext.title)
                .font(.caption)
                .foregroundStyle(
                    Color.white.opacity(AppVisualTokens.monogramGradientEndOpacity)
                )
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(Color.appOnBrand)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(AppLayout.heroPadding)
        .background(Color.appBrandGradient)
        .clipShape(
            RoundedRectangle(
                cornerRadius: AppLayout.surfaceRadius,
                style: .continuous
            )
        )
        .shadow(
            color: Color.appBrand.opacity(AppVisualTokens.heroShadowOpacity),
            radius: AppVisualTokens.heroShadowRadius,
            y: AppVisualTokens.heroShadowY
        )
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

    private var statusText: String {
        screen.match.preview.status == .inProgress
            ? "LIVE" : screen.match.preview.status.displayName.uppercased()
    }

    private var statusSystemImage: String {
        switch screen.match.preview.status {
        case .inProgress: "dot.radiowaves.left.and.right"
        case .final: "checkmark.circle.fill"
        case .scheduled: "clock.fill"
        case .unknown: "circle.fill"
        }
    }

    private var statusBackground: Color {
        screen.match.preview.status == .inProgress
            ? Color.appLive
            : Color.white.opacity(AppVisualTokens.statusPillOnBrandOpacity)
    }
}
