//
//  MatchEventLogView.swift
//  Ruski Report
//
//  Presents recorded plays by turn, keeping each team's two shooters together
//  before handing possession to the opponent.
//

import SwiftUI

struct MatchEventLogView: View {
    let screen: MatchDetailScreen
    let routeContext: MatchRouteContext

    private var recordedTurns: [MatchTurn] {
        screen.turns.filter(\.hasEvents)
    }

    var body: some View {
        MatchSectionView(
            title: MatchCopy.eventLogTitle,
            systemImage: "list.bullet.rectangle"
        ) {
            if recordedTurns.isEmpty {
                EmptyMatchSectionView(
                    title: MatchCopy.eventLogUnavailable,
                    systemImage: "list.bullet.rectangle"
                )
            } else {
                LazyVStack(spacing: AppLayout.contentSpacing) {
                    ForEach(recordedTurns) { turn in
                        MatchTurnCard(turn: turn, routeContext: routeContext) { teamTurn in
                            VStack(spacing: AppLayout.standardSpacing) {
                                ForEach(teamTurn.shots) { shot in
                                    MatchPlayShotRow(
                                        shot: shot,
                                        screen: screen,
                                        routeContext: routeContext
                                    )
                                }
                            }
                        }
                    }
                }
                .accessibilityIdentifier("match.events")
            }
        }
    }
}

private struct MatchPlayShotRow: View {
    let shot: MatchTurnShot
    let screen: MatchDetailScreen
    let routeContext: MatchRouteContext

    private var shooterName: String {
        routeContext.playerName(for: shot.playerId)
            ?? shot.scorecardRow?.values[MatchScorecardField.shooter]
            ?? MatchCopy.unknownShooter
    }

    var body: some View {
        HStack(alignment: .top, spacing: AppLayout.standardSpacing) {
            MatchShotMarker(position: shot.position)

            VStack(alignment: .leading, spacing: AppLayout.microSpacing) {
                Text(shooterName)
                    .font(.subheadline.weight(.semibold))

                if shot.events.isEmpty {
                    Text(MatchCopy.unrecordedShot)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(shot.events) { event in
                        MatchPlayResultView(
                            label: screen.eventLabel(for: event),
                            value: event.value
                        )
                    }
                }
            }

            Spacer(minLength: AppLayout.smallSpacing)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct MatchPlayResultView: View {
    let label: String
    let value: Double?

    var body: some View {
        HStack(spacing: AppLayout.microSpacing) {
            Text(label)
            if let value {
                Text(MatchValueFormatter.stat(value, valueType: "number"))
                    .monospacedDigit()
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }
}
