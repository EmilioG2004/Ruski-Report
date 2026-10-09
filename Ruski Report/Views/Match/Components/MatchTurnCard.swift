//
//  MatchTurnCard.swift
//  Ruski Report
//
//  Provides the shared round-and-team hierarchy for chronological match data.
//  Destination views inject only their shot content, keeping visual ordering
//  identical while allowing Plays and Scorecard to evolve independently.
//

import SwiftUI

struct MatchTurnCard<Content: View>: View {
    let turn: MatchTurn
    let routeContext: MatchRouteContext
    private let content: (MatchTeamTurn) -> Content

    init(
        turn: MatchTurn,
        routeContext: MatchRouteContext,
        @ViewBuilder content: @escaping (MatchTeamTurn) -> Content
    ) {
        self.turn = turn
        self.routeContext = routeContext
        self.content = content
    }

    var body: some View {
        AppSurface(style: .inset) {
            Text(MatchCopy.turnTitle(turn.number))
                .font(.caption.weight(.black))
                .tracking(AppVisualTokens.overlineTracking)
                .foregroundStyle(Color.appBrand)

            ForEach(Array(turn.teamTurns.enumerated()), id: \.element.id) { index, teamTurn in
                if index > 0 {
                    MatchTurnDivider()
                }

                VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
                    MatchTeamTurnHeader(
                        teamTurn: teamTurn,
                        routeContext: routeContext
                    )
                    content(teamTurn)
                }
            }
        }
    }
}

struct MatchShotMarker: View {
    let position: Int

    var body: some View {
        Text("\(position)")
            .font(.caption2.weight(.black).monospacedDigit())
            .foregroundStyle(Color.appBrand)
            .frame(
                width: AppLayout.shotMarkerSize,
                height: AppLayout.shotMarkerSize
            )
            .background(Color.appBrand.opacity(AppVisualTokens.subtleTintOpacity))
            .clipShape(Circle())
            .accessibilityLabel(MatchCopy.shotTitle(position))
    }
}

private struct MatchTeamTurnHeader: View {
    let teamTurn: MatchTeamTurn
    let routeContext: MatchRouteContext

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: AppLayout.smallSpacing) {
            Text(routeContext.teamName(for: teamTurn.teamId) ?? MatchCopy.unknownTeam)
                .font(.subheadline.weight(.bold))
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: AppLayout.smallSpacing)

            Text(MatchCopy.shootingOrder(teamTurn.order))
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        }
    }
}

private struct MatchTurnDivider: View {
    var body: some View {
        HStack(spacing: AppLayout.smallSpacing) {
            separator
            Image(systemName: "arrow.down")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.secondary)
            separator
        }
        .accessibilityHidden(true)
    }

    private var separator: some View {
        Rectangle()
            .fill(Color.appSeparator)
            .frame(height: AppLayout.hairlineWidth)
    }
}
