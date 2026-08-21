//
//  PublicMatchDetailContent.swift
//  Ruski Report
//
//  Canonical match presentation. Participant and historical player names come
//  exclusively from PublicMatchDetail instead of navigation context.
//

import SwiftUI

struct PublicMatchDetailHeaderView: View {
    let detail: PublicMatchDetail
    let availableHeight: CGFloat
    @Binding var selection: MatchDetailPanel

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.contentSpacing) {
            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    ScrollView { scoreHeader }
                        .frame(
                            maxHeight: availableHeight *
                                AppLayout.matchHeaderAccessibilityHeightFraction
                        )
                } else {
                    scoreHeader
                }
            }

            MatchPanelPicker(selection: $selection, commentCount: 0)
        }
        .padding(AppLayout.pagePadding)
        .frame(maxWidth: AppLayout.maximumContentWidth, alignment: .leading)
        .frame(maxWidth: .infinity)
    }

    private var scoreHeader: some View {
        VStack(alignment: .leading, spacing: AppLayout.largeSpacing) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: AppLayout.compactSpacing) {
                    statusLabel
                    Spacer(minLength: AppLayout.smallSpacing)
                    scheduleLabel
                }

                VStack(alignment: .leading, spacing: AppLayout.smallSpacing) {
                    statusLabel
                    scheduleLabel
                }
            }

            Text(detail.summary.contextDisplay.uppercased())
                .font(.caption2.weight(.black))
                .tracking(AppVisualTokens.overlineTracking)
                .foregroundStyle(
                    Color.white.opacity(AppVisualTokens.monogramGradientEndOpacity)
                )

            VStack(spacing: AppLayout.standardSpacing) {
                ForEach(detail.summary.participants, id: \.side) { participant in
                    PublicMatchHeroParticipantRow(
                        participant: participant,
                        scoreAvailability: detail.summary.scoreAvailability,
                        isWinner: detail.summary.winner?.id == participant.team.id
                    )
                }
            }
            .accessibilityIdentifier("match.public.scoreHeader")

            HStack(spacing: AppLayout.smallSpacing) {
                Text("Projection v\(detail.summary.projection.version)")
                if let revision = detail.summary.revision {
                    Text("· Revision \(revision)")
                }
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(
                Color.white.opacity(AppVisualTokens.monogramGradientEndOpacity)
            )

            if detail.summary.correction.isCorrection {
                Label(
                    detail.summary.correction.reason ?? "Corrected official result",
                    systemImage: "arrow.triangle.2.circlepath"
                )
                .font(.caption.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("match.public.correction")
            }
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
        .accessibilityIdentifier("match.public.detail")
    }

    private var statusLabel: some View {
        Label(
            detail.summary.status.displayName,
            systemImage: detail.summary.status.systemImage
        )
        .font(.caption.weight(.bold))
        .padding(.horizontal, AppLayout.pillHorizontalPadding)
        .padding(.vertical, AppLayout.pillVerticalPadding)
        .background(statusBackground)
        .clipShape(Capsule())
        .accessibilityIdentifier("match.public.status.\(detail.summary.status.rawValue)")
    }

    private var scheduleLabel: some View {
        Text(detail.summary.scheduleDisplay)
            .font(.caption.weight(.semibold))
            .multilineTextAlignment(.trailing)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var statusBackground: Color {
        detail.summary.status == .inProgress
            ? Color.appLive
            : Color.white.opacity(AppVisualTokens.statusPillOnBrandOpacity)
    }
}

private struct PublicMatchHeroParticipantRow: View {
    let participant: PublicMatchParticipant
    let scoreAvailability: PublicScoreAvailability
    let isWinner: Bool

    var body: some View {
        HStack(alignment: .top, spacing: AppLayout.standardSpacing) {
            TeamMonogramView(
                name: participant.team.name,
                size: AppLayout.heroTeamMonogramSize,
                onBrand: true
            )

            VStack(alignment: .leading, spacing: AppLayout.microSpacing) {
                Text(participant.team.name)
                    .font(.body.weight(isWinner ? .bold : .semibold))
                    .fixedSize(horizontal: false, vertical: true)

                if let seed = participant.seed {
                    Text(AppSportsCopy.seed(seed))
                        .font(.caption2)
                }

                Text(participant.players.map(\.displayName).joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(
                        Color.white.opacity(AppVisualTokens.secondaryOnBrandOpacity)
                    )
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier(
                        "match.public.participant.\(participant.team.id).players"
                    )
            }
            .layoutPriority(1)

            Spacer(minLength: AppLayout.smallSpacing)

            if isWinner {
                Image(systemName: "checkmark.circle.fill")
                    .accessibilityLabel(AppSportsCopy.winner)
            }

            Text(scoreText)
                .font(.title.weight(.black).monospacedDigit())
                .frame(minWidth: AppLayout.matchHeaderScoreWidth, alignment: .trailing)
        }
        .padding(.vertical, AppLayout.microSpacing)
        .accessibilityElement(children: .contain)
    }

    private var scoreText: String {
        switch scoreAvailability {
        case .partial, .complete:
            participant.score.map(String.init) ?? "–"
        case .notStarted, .unrecorded, .notApplicable:
            "–"
        }
    }
}

struct PublicMatchOverviewPanel: View {
    let detail: PublicMatchDetail

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.sectionSpacing) {
            if detail.summary.scoreAvailability == .unrecorded {
                MatchScoreAvailabilityNotice()
            }

            VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
                AppSectionHeader(
                    "Game snapshot",
                    subtitle: "Status and score availability remain independent."
                )

                LazyVGrid(columns: metricColumns, spacing: AppLayout.compactSpacing) {
                    AppMetricTile(
                        title: "Status",
                        value: detail.summary.status.displayName,
                        systemImage: detail.summary.status.systemImage
                    )
                    AppMetricTile(
                        title: "Score",
                        value: detail.summary.scoreAvailability.displayName,
                        systemImage: "number"
                    )
                    .accessibilityIdentifier(
                        "match.public.availability.\(detail.summary.scoreAvailability.rawValue)"
                    )
                    AppMetricTile(
                        title: "Plays",
                        value: "\(detail.events.count)",
                        systemImage: "list.number"
                    )
                    AppMetricTile(
                        title: "Revision",
                        value: detail.summary.revision.map(String.init) ?? "None",
                        systemImage: "clock.arrow.circlepath"
                    )
                }
            }
            .accessibilityIdentifier("match.public.overview")

            participantHistory
            PublicMatchBoxScoreView(boxScore: detail.boxScore)
            PublicMatchStatisticsView(statistics: detail.statistics)
        }
    }

    private var participantHistory: some View {
        MatchSectionView(title: "Historical participants", systemImage: "person.2") {
            VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
                ForEach(detail.summary.participants, id: \.side) { participant in
                    VStack(alignment: .leading, spacing: AppLayout.microSpacing) {
                        Text(participant.team.name)
                            .font(.subheadline.weight(.semibold))
                        Text(participant.players.map(\.displayName).joined(separator: " · "))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .accessibilityIdentifier(
                        "match.public.history.\(participant.team.id)"
                    )
                }
            }
        }
    }

    private var metricColumns: [GridItem] {
        [
            GridItem(.flexible(), spacing: AppLayout.compactSpacing),
            GridItem(.flexible(), spacing: AppLayout.compactSpacing)
        ]
    }
}

private struct PublicMatchBoxScoreView: View {
    let boxScore: PublicBoxScore?

    var body: some View {
        MatchSectionView(title: "Box score", systemImage: "tablecells") {
            if let boxScore, !boxScore.rows.isEmpty {
                ScrollView(.horizontal, showsIndicators: true) {
                    VStack(spacing: 0) {
                        HStack(spacing: 0) {
                            Text("Participant")
                                .boxScoreHeaderStyle(
                                    width: AppLayout.tableSubjectWidth,
                                    alignment: .leading
                                )
                            ForEach(boxScore.columns) { column in
                                Text(column.label)
                                    .boxScoreHeaderStyle(
                                        width: AppLayout.tableValueWidth,
                                        alignment: .trailing
                                    )
                            }
                        }
                        Divider()
                        ForEach(boxScore.rows) { row in
                            HStack(spacing: 0) {
                                Text(row.subjectDisplayName)
                                    .font(.subheadline.weight(.medium))
                                    .frame(
                                        width: AppLayout.tableSubjectWidth,
                                        alignment: .leading
                                    )
                                    .fixedSize(horizontal: false, vertical: true)
                                ForEach(boxScore.columns) { column in
                                    Text(value(row.values[column.key] ?? nil, format: column.format))
                                        .font(.subheadline.monospacedDigit())
                                        .frame(
                                            width: AppLayout.tableValueWidth,
                                            alignment: .trailing
                                        )
                                }
                            }
                            .padding(.vertical, AppLayout.smallSpacing)
                        }
                    }
                }
            } else {
                EmptyMatchSectionView(
                    title: "Box score is not available for this game.",
                    systemImage: "tablecells"
                )
            }
        }
        .accessibilityIdentifier("match.public.boxScore")
    }

    private func value(
        _ value: Double?,
        format: PublicBoxScoreColumnFormat
    ) -> String {
        switch format {
        case .integer: PublicDisplayValueFormatter.number(value)
        case .percentage: PublicDisplayValueFormatter.percentage(value)
        }
    }
}

private struct PublicMatchStatisticsView: View {
    let statistics: [PublicStatistic]

    var body: some View {
        if !statistics.isEmpty {
            MatchSectionView(title: "Statistics", systemImage: "chart.bar") {
                VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
                    ForEach(Array(statistics.enumerated()), id: \.offset) { _, statistic in
                        ForEach(statistic.values.sorted { $0.key < $1.key }, id: \.key) { value in
                            HStack {
                                Text(PublicDisplayValueFormatter.readableLabel(value.key))
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text(PublicDisplayValueFormatter.number(value.value))
                                    .font(.subheadline.monospacedDigit())
                            }
                        }
                    }
                }
            }
        }
    }
}

struct PublicMatchEventLogView: View {
    let detail: PublicMatchDetail

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
            AppSectionHeader(
                "Official plays",
                subtitle: "Events recorded in projection v\(detail.summary.projection.version).",
                count: detail.events.count
            )

            if detail.events.isEmpty {
                AppSurface {
                    EmptyMatchSectionView(
                        title: "No plays have been recorded.",
                        systemImage: "list.bullet.rectangle"
                    )
                }
            } else {
                ForEach(detail.events) { event in
                    AppSurface {
                        HStack(alignment: .top, spacing: AppLayout.standardSpacing) {
                            Text("#\(event.sequence)")
                                .font(.caption.weight(.bold).monospacedDigit())
                                .foregroundStyle(Color.appBrand)
                            VStack(alignment: .leading, spacing: AppLayout.microSpacing) {
                                Text(PublicDisplayValueFormatter.readableLabel(event.type))
                                    .font(.subheadline.weight(.semibold))
                                if let participant = participantLabel(for: event) {
                                    Text(participant)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                    }
                    .accessibilityIdentifier("match.public.event.\(event.id)")
                }
            }
        }
        .accessibilityIdentifier("match.public.events")
    }

    private func participantLabel(for event: PublicMatchEvent) -> String? {
        for participant in detail.summary.participants {
            if participant.team.id == event.teamId {
                if let player = participant.players.first(where: { $0.id == event.playerId }) {
                    return "\(participant.team.name) · \(player.displayName)"
                }
                return participant.team.name
            }
        }
        return nil
    }
}

struct PublicMatchScorecardView: View {
    let detail: PublicMatchDetail

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
            AppSectionHeader(
                "Official scorecard",
                subtitle: detail.summary.scoreAvailability.displayName
            )

            if let scorecard = detail.scorecard, !scorecard.rows.isEmpty {
                AppSurface {
                    ScrollView(.horizontal, showsIndicators: true) {
                        VStack(spacing: 0) {
                            HStack(spacing: 0) {
                                Text("Player")
                                    .boxScoreHeaderStyle(
                                        width: AppLayout.tableSubjectWidth,
                                        alignment: .leading
                                    )
                                ForEach(scorecard.columns) { column in
                                    Text(column.label)
                                        .boxScoreHeaderStyle(
                                            width: AppLayout.tableValueWidth,
                                            alignment: .trailing
                                        )
                                }
                            }
                            Divider()
                            ForEach(scorecard.rows) { row in
                                HStack(spacing: 0) {
                                    Text(row.playerDisplayName ?? "Team event")
                                        .font(.subheadline.weight(.medium))
                                        .frame(
                                            width: AppLayout.tableSubjectWidth,
                                            alignment: .leading
                                        )
                                        .fixedSize(horizontal: false, vertical: true)
                                    ForEach(scorecard.columns) { column in
                                        Text(PublicDisplayValueFormatter.json(row.values[column.key]))
                                            .font(.subheadline.monospacedDigit())
                                            .frame(
                                                width: AppLayout.tableValueWidth,
                                                alignment: .trailing
                                            )
                                    }
                                }
                                .padding(.vertical, AppLayout.smallSpacing)
                            }
                        }
                    }
                }
            } else {
                AppSurface {
                    EmptyMatchSectionView(
                        title: scorecardUnavailableMessage,
                        systemImage: "doc.badge.ellipsis"
                    )
                }
            }
        }
        .accessibilityIdentifier("match.public.scorecard")
    }

    private var scorecardUnavailableMessage: String {
        switch detail.summary.scoreAvailability {
        case .notStarted: "The scorecard will appear after play begins."
        case .partial: "The live score is available; scorecard rows are pending."
        case .complete: "The official scorecard is not available."
        case .unrecorded: "This final result has no recorded scorecard."
        case .notApplicable: "A scorecard does not apply to this resolution."
        }
    }
}
