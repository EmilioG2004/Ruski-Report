//
//  TournamentStatsView.swift
//  Ruski Report
//
//  Owns leaderboard selection and delegates table layout and value formatting
//  to focused collaborators.
//

import SwiftUI

struct TournamentStatsView: View {
    let screen: TournamentDetailScreen

    @State private var selectedTableID: String?

    var body: some View {
        if screen.detail.statistics.isEmpty {
            TournamentEmptySectionView(
                title: TournamentCopy.statsUnavailable,
                systemImage: "chart.bar"
            )
        } else {
            VStack(alignment: .leading, spacing: AppLayout.contentSpacing) {
                HStack(spacing: AppLayout.standardSpacing) {
                    AppSectionHeader(
                        TournamentCopy.statsTitle,
                        subtitle: TournamentCopy.statsSubtitle
                    )

                    Spacer(minLength: AppLayout.smallSpacing)

                    tablePicker
                }

                if let table = selectedTable {
                    TournamentStatisticTableView(
                        table: table,
                        columns: screen.statisticColumns(for: table)
                    )
                }
            }
            .onAppear {
                selectedTableID = selectedTableID ?? screen.detail.statistics.first?.id
            }
        }
    }

    private var selectedTable: TournamentStatisticTable? {
        screen.detail.statistics.first { $0.id == selectedTableID } ??
            screen.detail.statistics.first
    }

    private var tablePicker: some View {
        Picker("Statistics table", selection: $selectedTableID) {
            ForEach(screen.detail.statistics) { table in
                Text(pickerLabel(for: table))
                    .tag(Optional(table.id))
            }
        }
        .pickerStyle(.menu)
        .labelsHidden()
        .accessibilityIdentifier("tournament.stats.tablePicker")
    }

    private func pickerLabel(for table: TournamentStatisticTable) -> String {
        switch (table.scope, table.subjectType) {
        case ("season", "player"):
            "Season"
        case ("season", "team"):
            "Teams"
        case ("playoffs", _):
            "Playoffs"
        default:
            table.name
        }
    }
}
