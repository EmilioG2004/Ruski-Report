//
//  PublicTournamentDetailContentView.swift
//  Ruski Report
//
//  Renders one immutable canonical tournament projection, including lifecycle,
//  standings, current rosters, matches, statistics, and bracket progression.
//

import SwiftUI

struct PublicTournamentDetailContentView: View {
    let detail: PublicTournamentDetail
    @Binding var selectedSection: TournamentDetailSection
    var discoveryScope: PublicTournamentDiscoveryScope = .active

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: AppLayout.largeSpacing) {
                PublicTournamentHeaderView(detail: detail)

                TournamentSectionPicker(selection: $selectedSection)

                sectionContent
                    .id(selectedSection)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
            .padding(AppLayout.pagePadding)
            .frame(maxWidth: AppLayout.maximumContentWidth, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .accessibilityIdentifier("tournament.public.detail")
    }

    @ViewBuilder
    private var sectionContent: some View {
        switch selectedSection {
        case .overview:
            PublicTournamentOverviewView(detail: detail)
        case .pods:
            PublicTournamentPodsView(detail: detail)
        case .matches:
            PublicTournamentMatchesView(
                detail: detail,
                discoveryScope: discoveryScope
            )
        case .bracket:
            PublicTournamentBracketView(
                detail: detail,
                discoveryScope: discoveryScope
            )
        case .stats:
            PublicTournamentStatisticsView(detail: detail)
        }
    }
}

private struct PublicTournamentHeaderView: View {
    let detail: PublicTournamentDetail

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.contentSpacing) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: AppLayout.compactSpacing) {
                    Text("OFFICIAL TOURNAMENT")
                        .font(.caption2.weight(.black))
                        .tracking(AppVisualTokens.overlineTracking)
                    Spacer(minLength: AppLayout.smallSpacing)
                    lifecycleLabel
                }

                VStack(alignment: .leading, spacing: AppLayout.smallSpacing) {
                    Text("OFFICIAL TOURNAMENT")
                        .font(.caption2.weight(.black))
                        .tracking(AppVisualTokens.overlineTracking)
                    lifecycleLabel
                }
            }

            Text(detail.name)
                .font(.title.weight(.black))
                .fixedSize(horizontal: false, vertical: true)

            Text("\(detail.year) · Projection v\(detail.projection.version)")
                .font(.subheadline.weight(.medium).monospacedDigit())
                .foregroundStyle(
                    Color.white.opacity(AppVisualTokens.secondaryOnBrandOpacity)
                )
                .accessibilityIdentifier("tournament.public.projection")

            HStack(spacing: AppLayout.largeSpacing) {
                Label("\(detail.rosters.count) teams", systemImage: "person.3.fill")
                Label("\(detail.matches.count) games", systemImage: "sportscourt.fill")
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(
                Color.white.opacity(AppVisualTokens.strongOnBrandOpacity)
            )
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
    }

    private var lifecycleLabel: some View {
        Label(detail.lifecycle.displayName, systemImage: "trophy.fill")
            .font(.caption.weight(.bold))
            .padding(.horizontal, AppLayout.pillHorizontalPadding)
            .padding(.vertical, AppLayout.pillVerticalPadding)
            .background(
                Color.white.opacity(AppVisualTokens.statusPillOnBrandOpacity)
            )
            .clipShape(Capsule())
    }
}

private struct PublicTournamentOverviewView: View {
    let detail: PublicTournamentDetail

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.sectionSpacing) {
            VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
                AppSectionHeader(
                    "Tournament snapshot",
                    subtitle: "The structure frozen into this official projection."
                )

                LazyVGrid(columns: metricColumns, spacing: AppLayout.compactSpacing) {
                    AppMetricTile(title: "Season", value: "\(detail.year)", systemImage: "calendar")
                    AppMetricTile(title: "Teams", value: "\(detail.rosters.count)", systemImage: "person.3")
                    AppMetricTile(title: "Games", value: "\(detail.matches.count)", systemImage: "sportscourt")
                    AppMetricTile(title: "Bracket", value: "\(detail.bracket?.size ?? 0)", systemImage: "trophy")
                }
            }

            VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
                AppSectionHeader(
                    "Current rosters",
                    subtitle: "Completed games retain their historical participants."
                )

                if detail.rosters.isEmpty {
                    TournamentEmptySectionView(
                        title: "Rosters are not published yet",
                        systemImage: "person.3"
                    )
                } else {
                    ForEach(detail.rosters) { team in
                        AppSurface {
                            HStack(alignment: .top, spacing: AppLayout.standardSpacing) {
                                TeamMonogramView(name: team.name)
                                VStack(alignment: .leading, spacing: AppLayout.smallSpacing) {
                                    Text(team.name)
                                        .font(.headline)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Text(team.players.map(\.displayName).joined(separator: " · "))
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                Spacer(minLength: 0)
                                Text("#\(team.initialPodSeed)")
                                    .font(.caption.weight(.bold).monospacedDigit())
                                    .foregroundStyle(Color.appBrand)
                            }
                        }
                        .accessibilityIdentifier("tournament.public.roster.\(team.id)")
                    }
                }
            }
        }
        .accessibilityIdentifier("tournament.public.overview")
    }

    private var metricColumns: [GridItem] {
        [
            GridItem(.flexible(), spacing: AppLayout.compactSpacing),
            GridItem(.flexible(), spacing: AppLayout.compactSpacing)
        ]
    }
}

private struct PublicTournamentPodsView: View {
    let detail: PublicTournamentDetail

    var body: some View {
        if detail.pods.isEmpty {
            TournamentEmptySectionView(
                title: "Pods are not available yet",
                systemImage: "square.grid.2x2"
            )
        } else {
            VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
                AppSectionHeader(
                    "Pod standings",
                    subtitle: "Official records, differential, and shooting percentage.",
                    count: detail.pods.count
                )

                ForEach(detail.pods.sorted { $0.sequence < $1.sequence }) { pod in
                    PublicPodStandingsCard(pod: pod)
                }
            }
        }
    }
}

private struct PublicPodStandingsCard: View {
    let pod: PublicPod

    var body: some View {
        AppSurface {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) {
                    podTitle
                    Spacer(minLength: AppLayout.smallSpacing)
                    stateLabel
                }

                VStack(alignment: .leading, spacing: AppLayout.smallSpacing) {
                    podTitle
                    stateLabel
                }
            }

            if pod.standings.isEmpty {
                Text("Teams are ready; standings begin after the first result.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(spacing: AppLayout.standardSpacing) {
                    ForEach(pod.standings) { row in
                        PublicStandingRowView(row: row)
                        if row.id != pod.standings.last?.id {
                            Divider()
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("tournament.public.pod.\(pod.id)")
        .accessibilityValue(pod.standingState.displayName)
    }

    private var podTitle: some View {
        Text(pod.name)
            .font(.headline)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var stateLabel: some View {
        StatusPill(
            text: pod.standingState.displayName,
            style: pod.standingState == .finalized ? .final : .neutral
        )
        .accessibilityIdentifier(
            "tournament.public.pod.state.\(pod.standingState.rawValue)"
        )
    }
}

private struct PublicStandingRowView: View {
    let row: PublicStanding

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.compactSpacing) {
            HStack(alignment: .top, spacing: AppLayout.compactSpacing) {
                Text(row.rank.map { "#\($0)" } ?? "–")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(row.rank == nil ? Color.secondary : Color.appBrand)
                    .frame(width: AppLayout.podRankWidth, alignment: .leading)

                Text(row.team.name)
                    .font(.subheadline.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 0)

                if row.administratorResolved {
                    Label("Admin resolved", systemImage: "checkmark.seal.fill")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.appBrand)
                        .accessibilityIdentifier("tournament.public.standing.\(row.id).adminResolved")
                }
            }

            ViewThatFits(in: .horizontal) {
                HStack(spacing: AppLayout.largeSpacing) { metrics }
                VStack(alignment: .leading, spacing: AppLayout.smallSpacing) { metrics }
            }

            if let tieGroup = row.tieGroup {
                Text("Unresolved tie · \(tieGroup)")
                    .font(.caption)
                    .foregroundStyle(Color.appBrandSecondary)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("tournament.public.standing.\(row.id)")
    }

    @ViewBuilder
    private var metrics: some View {
        TournamentPodStandingMetric(title: "Record", value: "\(row.wins)-\(row.losses)")
        TournamentPodStandingMetric(
            title: "Cup Diff",
            value: row.cupDifferential >= 0
                ? "+\(row.cupDifferential)"
                : "\(row.cupDifferential)"
        )
        TournamentPodStandingMetric(
            title: "Shooting",
            value: PublicDisplayValueFormatter.percentage(row.shootingPercentage)
        )
    }
}

private struct PublicTournamentMatchesView: View {
    let detail: PublicTournamentDetail
    let discoveryScope: PublicTournamentDiscoveryScope

    @EnvironmentObject private var navigation: AppNavigationController

    var body: some View {
        if detail.matches.isEmpty {
            TournamentEmptySectionView(
                title: "Games are not available yet",
                systemImage: "sportscourt"
            )
        } else {
            VStack(alignment: .leading, spacing: AppLayout.sectionSpacing) {
                ForEach(PublicMatchGroup.allCases) { group in
                    let matches = detail.matches.filter { group.statuses.contains($0.status) }
                    if !matches.isEmpty {
                        VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
                            AppSectionHeader(group.title, subtitle: group.subtitle, count: matches.count)
                            ForEach(matches) { match in
                                PublicMatchScoreCard(
                                    match: match,
                                    accessibilityIdentifier: "tournament.public.match.\(match.id)"
                                ) {
                                    navigation.showMatch(
                                        match,
                                        discoveryScope: discoveryScope
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private enum PublicMatchGroup: String, CaseIterable, Identifiable {
    case live
    case upcoming
    case resolved

    var id: String { rawValue }
    var title: String {
        switch self {
        case .live: "Live now"
        case .upcoming: "Scheduled"
        case .resolved: "Results and resolutions"
        }
    }
    var subtitle: String {
        switch self {
        case .live: "Partial official scores update with the projection."
        case .upcoming: "Unknown times remain explicitly unscheduled."
        case .resolved: "Finals, forfeits, and cancellations stay distinct."
        }
    }
    var statuses: [PublicMatchStatus] {
        switch self {
        case .live: [.inProgress]
        case .upcoming: [.scheduled, .postponed]
        case .resolved: [.final, .forfeited, .cancelled]
        }
    }
}

private struct PublicTournamentBracketView: View {
    let detail: PublicTournamentDetail
    let discoveryScope: PublicTournamentDiscoveryScope

    @EnvironmentObject private var navigation: AppNavigationController

    var body: some View {
        if let bracket = detail.bracket, !bracket.rounds.isEmpty {
            VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
                AppSectionHeader(
                    bracket.name,
                    subtitle: "Swipe across every official round.",
                    count: bracket.rounds.count
                )

                ScrollView(.horizontal, showsIndicators: true) {
                    LazyHStack(alignment: .top, spacing: AppLayout.largeSpacing) {
                        ForEach(bracket.rounds) { round in
                            VStack(alignment: .leading, spacing: AppLayout.smallSpacing) {
                                Text(round.name)
                                    .font(.headline)
                                ForEach(round.matches) { match in
                                    PublicBracketMatchCard(
                                        match: match,
                                        summary: summary(for: match)
                                    ) {
                                        guard let summary = summary(for: match) else { return }
                                        navigation.showMatch(
                                            summary,
                                            discoveryScope: discoveryScope
                                        )
                                    }
                                }
                            }
                            .frame(width: AppLayout.bracketRoundWidth)
                        }
                    }
                    .padding(.bottom, AppLayout.smallSpacing)
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("tournament.public.bracket")
            }
        } else {
            TournamentEmptySectionView(
                title: "Bracket is not available yet",
                systemImage: "rectangle.grid.2x2"
            )
            .accessibilityIdentifier("tournament.public.bracket.state.empty")
        }
    }

    private func summary(for match: PublicBracketMatch) -> PublicMatchSummary? {
        guard let matchId = match.matchId else { return nil }
        return detail.matches.first { $0.id == matchId }
    }
}

private struct PublicBracketMatchCard: View {
    let match: PublicBracketMatch
    let summary: PublicMatchSummary?
    let action: () -> Void

    var body: some View {
        Group {
            if summary == nil {
                card
            } else {
                Button(action: action) { card }
                    .buttonStyle(.plain)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("tournament.public.bracket.match.\(match.id)")
        .accessibilityValue(displayState.label)
    }

    private var card: some View {
        AppSurface {
            StatusMetadataLine(
                text: displayState.label,
                style: displayState.style,
                metadata: "Game \(match.position)"
            )
            .accessibilityIdentifier(
                "tournament.public.bracket.state.\(displayState.rawValue)"
            )

            VStack(spacing: AppLayout.smallSpacing) {
                ForEach(slotRows) { slot in
                    HStack(alignment: .top, spacing: AppLayout.smallSpacing) {
                        Text(slot.seed.map { "#\($0)" } ?? "–")
                            .font(.caption.weight(.semibold).monospacedDigit())
                            .foregroundStyle(.secondary)
                            .frame(width: AppLayout.bracketSeedWidth, alignment: .leading)
                        Text(slot.name)
                            .font(.subheadline.weight(slot.isWinner ? .bold : .regular))
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                        if slot.isWinner {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(Color.appFinal)
                                .accessibilityLabel(AppSportsCopy.winner)
                        }
                    }
                    .padding(.vertical, AppLayout.smallSpacing)
                    .accessibilityIdentifier(slot.identifier)
                }
            }

            if match.status == .bye {
                Label("Automatic advance", systemImage: "arrowshape.right.circle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.appBrand)
                    .accessibilityIdentifier("tournament.public.bracket.state.automatic")
            }

            if match.status == .corrected {
                Label(
                    "Corrected official result",
                    systemImage: "arrow.triangle.2.circlepath"
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.appBrand)
                .accessibilityIdentifier("tournament.public.bracket.state.corrected")
            }
        }
    }

    private var slotRows: [PublicBracketSlotRow] {
        match.slots.enumerated().map { index, slot in
            switch slot {
            case .team(let team, let seed):
                PublicBracketSlotRow(
                    id: "\(match.id)-\(index)",
                    name: team.name,
                    seed: seed,
                    isWinner: match.winner?.id == team.id,
                    identifier: "tournament.public.bracket.slot.team"
                )
            case .matchWinner(let sourceId, let team, let seed):
                PublicBracketSlotRow(
                    id: "\(match.id)-\(index)",
                    name: team?.name ?? "Waiting for \(sourceId)",
                    seed: seed,
                    isWinner: team.map { match.winner?.id == $0.id } ?? false,
                    identifier: "tournament.public.bracket.slot.waiting"
                )
            case .bye:
                PublicBracketSlotRow(
                    id: "\(match.id)-\(index)",
                    name: "Bye",
                    seed: nil,
                    isWinner: false,
                    identifier: "tournament.public.bracket.slot.bye"
                )
            case .tbd:
                PublicBracketSlotRow(
                    id: "\(match.id)-\(index)",
                    name: "TBD",
                    seed: nil,
                    isWinner: false,
                    identifier: "tournament.public.bracket.slot.tbd"
                )
            }
        }
    }

    private var displayState: PublicBracketDisplayState {
        if match.status == .bye { return .automatic }
        if match.status == .inProgress { return .live }
        if match.status == .completed || match.status == .corrected { return .completed }
        if match.slots.contains(where: { if case .tbd = $0 { true } else { false } }) {
            return .blocked
        }
        if match.slots.contains(where: {
            if case .matchWinner(_, let team, _) = $0 { team == nil } else { false }
        }) {
            return .waiting
        }
        return .ready
    }
}

private struct PublicBracketSlotRow: Identifiable {
    let id: String
    let name: String
    let seed: Int?
    let isWinner: Bool
    let identifier: String
}

private enum PublicBracketDisplayState {
    case automatic
    case blocked
    case waiting
    case ready
    case live
    case completed

    var rawValue: String {
        switch self {
        case .automatic: "automatic"
        case .blocked: "blocked"
        case .waiting: "waiting"
        case .ready: "ready"
        case .live: "live"
        case .completed: "completed"
        }
    }

    var label: String {
        switch self {
        case .automatic: "Automatic"
        case .blocked: "Blocked"
        case .waiting: "Waiting"
        case .ready: "Ready"
        case .live: "Live"
        case .completed: "Completed"
        }
    }

    var style: StatusPill.Style {
        switch self {
        case .live: .live
        case .completed, .automatic: .final
        case .ready: .scheduled
        case .blocked, .waiting: .neutral
        }
    }
}

private struct PublicTournamentStatisticsView: View {
    let detail: PublicTournamentDetail

    var body: some View {
        if rows.isEmpty {
            TournamentEmptySectionView(
                title: "Stats are not available yet",
                systemImage: "chart.bar"
            )
        } else {
            VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
                AppSectionHeader(
                    "Official statistics",
                    subtitle: "Values from projection v\(detail.projection.version).",
                    count: rows.count
                )

                ForEach(rows) { row in
                    AppSurface {
                        Text(row.subject)
                            .font(.headline)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(row.scope)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        ForEach(row.values, id: \.key) { value in
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
            .accessibilityIdentifier("tournament.public.statistics")
        }
    }

    private var rows: [PublicStatisticDisplayRow] {
        detail.statistics.enumerated().map { index, statistic in
            PublicStatisticDisplayRow(statistic: statistic, index: index)
        }
    }
}

private struct PublicStatisticDisplayRow: Identifiable {
    let id: String
    let subject: String
    let scope: String
    let values: [(key: String, value: Double?)]

    init(statistic: PublicStatistic, index: Int) {
        id = "\(statistic.scope.rawValue)-\(statistic.scopeId)-\(index)"
        subject = switch statistic.subject {
        case .team(let team): team.name
        case .player(_, let displayName): displayName
        case nil: "Tournament"
        }
        scope = statistic.stage.map { "\(statistic.scope.rawValue) · \($0.rawValue)" }
            ?? statistic.scope.rawValue
        values = statistic.values.sorted { $0.key < $1.key }
    }
}
