//
//  MatchScorecardView.swift
//  Ruski Report
//
//  Renders schema-driven shot results inside the shared chronological turn
//  hierarchy, replacing the team-flattened horizontal spreadsheet treatment.
//

import SwiftUI

struct MatchScorecardView: View {
    let screen: MatchDetailScreen
    let routeContext: MatchRouteContext

    private var scorecard: Scorecard? { screen.match.scorecard }

    private var recordedTurns: [MatchTurn] {
        screen.turns.filter { turn in
            turn.teamTurns.contains { teamTurn in
                teamTurn.shots.contains { $0.scorecardRow != nil }
            }
        }
    }

    var body: some View {
        MatchSectionView(title: MatchCopy.scorecardTitle, systemImage: "tablecells") {
            if let scorecard, !recordedTurns.isEmpty {
                LazyVStack(spacing: AppLayout.contentSpacing) {
                    ForEach(recordedTurns) { turn in
                        MatchTurnCard(turn: turn, routeContext: routeContext) { teamTurn in
                            VStack(spacing: AppLayout.standardSpacing) {
                                ForEach(teamTurn.shots) { shot in
                                    if let row = shot.scorecardRow {
                                        MatchScorecardShotRow(
                                            shot: shot,
                                            row: row,
                                            columns: scorecard.columns,
                                            routeContext: routeContext
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
                .accessibilityIdentifier("match.scorecard")
            } else {
                EmptyMatchSectionView(
                    title: MatchCopy.scorecardUnavailable,
                    systemImage: "tablecells"
                )
            }
        }
    }
}

private struct MatchScorecardShotRow: View {
    let shot: MatchTurnShot
    let row: ScorecardRow
    let columns: [ScorecardColumn]
    let routeContext: MatchRouteContext

    private var shooterName: String {
        routeContext.playerName(for: shot.playerId)
            ?? row.values[MatchScorecardField.shooter]
            ?? MatchCopy.unknownShooter
    }

    private var resultSummary: String {
        let results = columns.compactMap(resultText(for:))
        return results.isEmpty ? MatchCopy.unrecordedShot : results.joined(separator: " · ")
    }

    var body: some View {
        HStack(alignment: .top, spacing: AppLayout.standardSpacing) {
            MatchShotMarker(position: shot.position)

            VStack(alignment: .leading, spacing: AppLayout.microSpacing) {
                Text(shooterName)
                    .font(.subheadline.weight(.semibold))
                Text(resultSummary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: AppLayout.smallSpacing)
        }
        .accessibilityElement(children: .combine)
    }

    private func resultText(for column: ScorecardColumn) -> String? {
        guard !MatchScorecardField.identityKeys.contains(column.key) else {
            return nil
        }

        let value = row.values[column.key]
        if column.dataType == "boolean" || column.dataType == "event" {
            return MatchValueFormatter.bool(value) ? column.label : nil
        }

        guard let value, !value.isEmpty else { return nil }
        return "\(column.label): \(value)"
    }
}
