//
//  MatchEventLogView.swift
//  Ruski Report
//

import SwiftUI

struct MatchEventLogView: View {
    let screen: MatchDetailScreen
    let routeContext: MatchRouteContext

    private var events: [GameEvent] {
        screen.match.events.sorted { $0.sequence < $1.sequence }
    }

    var body: some View {
        MatchSectionView(
            title: "Shot & Event Log",
            systemImage: "list.bullet.rectangle"
        ) {
            if events.isEmpty {
                EmptyMatchSectionView(
                    title: "Event log is not available yet",
                    systemImage: "list.bullet.rectangle"
                )
            } else {
                VStack(spacing: 12) {
                    ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                        if index > 0 {
                            Divider()
                        }

                        MatchEventRow(
                            sequence: event.sequence,
                            label: screen.eventLabel(for: event),
                            detail: eventDetailText(for: event),
                            value: event.value
                        )
                    }
                }
                .accessibilityIdentifier("match.events")
            }
        }
    }

    private func eventDetailText(for event: GameEvent) -> String {
        [
            routeContext.teamName(for: event.teamId),
            routeContext.playerName(for: event.playerId)
        ]
        .compactMap { $0 }
        .joined(separator: " - ")
    }
}

private struct MatchEventRow: View {
    let sequence: Int
    let label: String
    let detail: String
    let value: Double?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(sequence)")
                .font(.caption.weight(.bold).monospacedDigit())
                .foregroundStyle(Color.accentColor)
                .frame(width: 28, alignment: .trailing)

            VStack(alignment: .leading, spacing: 4) {
                Text(label)
                    .font(.subheadline.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)

                if !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Spacer(minLength: 8)

            if let value {
                Text(MatchValueFormatter.stat(value, valueType: "number"))
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
