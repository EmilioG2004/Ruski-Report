//
//  MatchEventLogView.swift
//  Ruski Report
//
//  Presents ordered game events with route-provided participant context while
//  remaining independent of panel navigation and scrolling.
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
            title: MatchCopy.eventLogTitle,
            systemImage: "list.bullet.rectangle"
        ) {
            if events.isEmpty {
                EmptyMatchSectionView(
                    title: MatchCopy.eventLogUnavailable,
                    systemImage: "list.bullet.rectangle"
                )
            } else {
                VStack(spacing: AppLayout.standardSpacing) {
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
        .joined(separator: " · ")
    }
}

private struct MatchEventRow: View {
    let sequence: Int
    let label: String
    let detail: String
    let value: Double?

    var body: some View {
        HStack(alignment: .top, spacing: AppLayout.standardSpacing) {
            Text("\(sequence)")
                .font(.caption.weight(.bold).monospacedDigit())
                .foregroundStyle(Color.accentColor)
                .frame(width: AppLayout.eventSequenceWidth, alignment: .trailing)

            VStack(alignment: .leading, spacing: AppLayout.microSpacing) {
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

            Spacer(minLength: AppLayout.smallSpacing)

            if let value {
                Text(MatchValueFormatter.stat(value, valueType: "number"))
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
