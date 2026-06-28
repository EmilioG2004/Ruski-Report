//
//  MatchDetailView.swift
//  Ruski Report
//

import Foundation
import SwiftUI

struct MatchDetailView: View {
    @StateObject private var controller: MatchDetailController

    private let routeContext: MatchRouteContext

    init(
        routeContext: MatchRouteContext,
        matches: any MatchRepository,
        games: any GameRepository,
        logger: any AppLogger
    ) {
        self.routeContext = routeContext
        _controller = StateObject(
            wrappedValue: MatchDetailController(
                matchId: routeContext.matchId,
                matches: matches,
                games: games,
                logger: logger
            )
        )
    }

    var body: some View {
        Group {
            switch controller.state {
            case .loading:
                ProgressView("Loading match")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityIdentifier("match.loading")
            case .loaded(let screen):
                detailContent(screen)
            case .failed(let message):
                errorContent(message)
            }
        }
        .background(Color.appGroupedBackground)
        .navigationTitle("Match")
        .appInlineNavigationTitle()
        .task {
            await controller.loadMatch()
        }
    }

    private func detailContent(_ screen: MatchDetailScreen) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                MatchScoreHeaderView(
                    screen: screen,
                    routeContext: routeContext
                )

                MatchBoxScoreView(screen: screen)

                MatchScorecardView(scorecard: screen.match.scorecard)

                MatchEventLogView(
                    screen: screen,
                    routeContext: routeContext
                )

                MatchCommentsPreviewView(summary: screen.match.commentsSummary)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityIdentifier("match.detail")
    }

    private func errorContent(_ message: String) -> some View {
        ContentUnavailableView {
            Label("Match unavailable", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button("Retry") {
                Task {
                    await controller.loadMatch()
                }
            }
            .accessibilityIdentifier("match.retry")
        }
        .accessibilityIdentifier("match.error")
    }
}

private struct MatchScoreHeaderView: View {
    let screen: MatchDetailScreen
    let routeContext: MatchRouteContext

    var body: some View {
        TournamentDetailCard {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(routeContext.title)
                        .font(.title3.weight(.bold))
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)

                    if let phase = screen.match.preview.currentPhaseLabel {
                        Text(phase)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer(minLength: 12)

                StatusPill(text: screen.match.preview.status.displayName)
            }

            VStack(spacing: 10) {
                ForEach(screen.match.preview.participants, id: \.teamId) { participant in
                    HStack(spacing: 12) {
                        Text(routeContext.teamName(for: participant.teamId) ?? participant.teamId)
                            .font(.body.weight(.medium))
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)

                        Spacer(minLength: 12)

                        Text(scoreText(for: participant))
                            .font(.title3.weight(.semibold).monospacedDigit())
                            .foregroundStyle(scoreColor(for: participant))
                    }
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

    private func scoreColor(for participant: MatchParticipant) -> Color {
        guard screen.match.preview.score?.winnerTeamId == participant.teamId else {
            return .primary
        }

        return .accentColor
    }
}

private struct MatchBoxScoreView: View {
    let screen: MatchDetailScreen

    var body: some View {
        MatchSectionView(
            title: "Box Score",
            systemImage: "chart.bar.xaxis"
        ) {
            if let boxScore = screen.match.boxScore,
               !screen.boxScoreColumns.isEmpty {
                ScrollView(.horizontal, showsIndicators: true) {
                    Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 10) {
                        GridRow {
                            Text("Player")
                                .boxScoreHeaderStyle(width: 140, alignment: .leading)

                            ForEach(screen.boxScoreColumns) { column in
                                Text(column.label)
                                    .boxScoreHeaderStyle(width: 104, alignment: .trailing)
                            }
                        }

                        ForEach(boxScore.rows) { row in
                            GridRow {
                                Text(row.label)
                                    .font(.subheadline.weight(.medium))
                                    .frame(width: 140, alignment: .leading)

                                ForEach(screen.boxScoreColumns) { column in
                                    Text(
                                        MatchValueFormatter.stat(
                                            row.stats[column.key],
                                            valueType: column.valueType
                                        )
                                    )
                                    .font(.subheadline.monospacedDigit())
                                    .frame(width: 104, alignment: .trailing)
                                }
                            }
                        }

                        if !boxScore.totals.isEmpty {
                            GridRow {
                                Text("Total")
                                    .font(.subheadline.weight(.bold))
                                    .frame(width: 140, alignment: .leading)

                                ForEach(screen.boxScoreColumns) { column in
                                    Text(
                                        MatchValueFormatter.stat(
                                            boxScore.totals[column.key],
                                            valueType: column.valueType
                                        )
                                    )
                                    .font(.subheadline.weight(.bold).monospacedDigit())
                                    .frame(width: 104, alignment: .trailing)
                                }
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
                .accessibilityIdentifier("match.boxScore")
            } else {
                EmptyMatchSectionView(
                    title: "Box score is not available yet",
                    systemImage: "chart.bar.xaxis"
                )
            }
        }
    }
}

private struct MatchScorecardView: View {
    let scorecard: Scorecard?

    var body: some View {
        MatchSectionView(
            title: "Scorecard",
            systemImage: "tablecells"
        ) {
            if let scorecard,
               !scorecard.columns.isEmpty,
               !scorecard.rows.isEmpty {
                ScrollView(.horizontal, showsIndicators: true) {
                    Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 10) {
                        GridRow {
                            ForEach(scorecard.columns) { column in
                                Text(column.label)
                                    .scorecardHeaderStyle(width: width(for: column))
                            }
                        }

                        ForEach(scorecard.rows.sorted { $0.sequence < $1.sequence }) { row in
                            GridRow {
                                ForEach(scorecard.columns) { column in
                                    scorecardCell(row: row, column: column)
                                        .frame(
                                            width: width(for: column),
                                            alignment: alignment(for: column)
                                        )
                                        .frame(minHeight: 28)
                                }
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
                .accessibilityIdentifier("match.scorecard")
            } else {
                EmptyMatchSectionView(
                    title: "Scorecard rows are not available yet",
                    systemImage: "tablecells"
                )
            }
        }
    }

    @ViewBuilder
    private func scorecardCell(
        row: ScorecardRow,
        column: ScorecardColumn
    ) -> some View {
        if column.dataType == "boolean" {
            if MatchValueFormatter.bool(row.values[column.key]) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color.accentColor)
                    .accessibilityLabel("\(column.label) selected")
            } else {
                Text("")
                    .accessibilityLabel("\(column.label) not selected")
            }
        } else {
            Text(row.values[column.key] ?? "-")
                .font(.subheadline)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }

    private func width(for column: ScorecardColumn) -> CGFloat {
        switch column.dataType {
        case "boolean":
            78
        case "number":
            70
        case "player":
            132
        default:
            116
        }
    }

    private func alignment(for column: ScorecardColumn) -> Alignment {
        column.dataType == "boolean" ? .center : .leading
    }
}

private struct MatchEventLogView: View {
    let screen: MatchDetailScreen
    let routeContext: MatchRouteContext

    var body: some View {
        MatchSectionView(
            title: "Shot & Event Log",
            systemImage: "list.bullet.rectangle"
        ) {
            let events = screen.match.events.sorted { $0.sequence < $1.sequence }

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

                        HStack(alignment: .top, spacing: 12) {
                            Text("\(event.sequence)")
                                .font(.caption.weight(.semibold).monospacedDigit())
                                .foregroundStyle(.secondary)
                                .frame(width: 28, alignment: .trailing)

                            VStack(alignment: .leading, spacing: 4) {
                                Text(screen.eventLabel(for: event))
                                    .font(.subheadline.weight(.semibold))

                                let detailText = eventDetailText(for: event)
                                if !detailText.isEmpty {
                                    Text(detailText)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }

                            Spacer(minLength: 12)

                            if let value = event.value {
                                Text(MatchValueFormatter.stat(value, valueType: "number"))
                                    .font(.caption.weight(.semibold).monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                        }
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
        .joined(separator: " | ")
    }
}

private struct MatchCommentsPreviewView: View {
    let summary: MatchCommentsSummary?

    var body: some View {
        MatchSectionView(
            title: "Comments",
            systemImage: "text.bubble"
        ) {
            HStack(spacing: 12) {
                Image(systemName: "text.bubble")
                    .frame(width: 28, height: 28)
                    .foregroundStyle(Color.accentColor)

                VStack(alignment: .leading, spacing: 4) {
                    Text(commentCountText)
                        .font(.body.weight(.medium))

                    Text(latestCommentText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 0)
            }
            .accessibilityIdentifier("match.commentsPreview")
        }
    }

    private var commentCountText: String {
        let count = summary?.count ?? 0

        if count == 0 {
            return "No comments yet"
        }

        if count == 1 {
            return "1 comment"
        }

        return "\(count) comments"
    }

    private var latestCommentText: String {
        guard let latestCommentAt = summary?.latestCommentAt else {
            return "No recent comments"
        }

        return "Latest comment \(latestCommentAt)"
    }
}

private struct MatchSectionView<Content: View>: View {
    let title: String
    let systemImage: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: systemImage)
                .font(.headline)

            TournamentDetailCard {
                content
            }
        }
    }
}

private struct EmptyMatchSectionView: View {
    let title: String
    let systemImage: String

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 12)
    }
}

private enum MatchValueFormatter {
    static func stat(_ value: Double?, valueType: String) -> String {
        guard let value else {
            return "-"
        }

        if valueType == "percentage" {
            return "\(number(value * 100))%"
        }

        return number(value)
    }

    static func bool(_ value: String?) -> Bool {
        guard let value else {
            return false
        }

        switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "true", "yes", "1":
            return true
        default:
            return false
        }
    }

    private static func number(_ value: Double) -> String {
        guard value.isFinite else {
            return "-"
        }

        if value.rounded() == value {
            return "\(Int(value))"
        }

        return String(format: "%.1f", value)
    }
}

private extension Text {
    func boxScoreHeaderStyle(width: CGFloat, alignment: Alignment) -> some View {
        font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .lineLimit(2)
            .minimumScaleFactor(0.75)
            .frame(width: width, alignment: alignment)
    }

    func scorecardHeaderStyle(width: CGFloat) -> some View {
        font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .lineLimit(2)
            .minimumScaleFactor(0.75)
            .frame(width: width, alignment: .leading)
    }
}
