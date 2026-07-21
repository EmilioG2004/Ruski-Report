//
//  TournamentStatsView.swift
//  Ruski Report
//

import SwiftUI

struct TournamentStatsView: View {
    let screen: TournamentDetailScreen

    @State private var selectedTableID: String?

    var body: some View {
        if screen.detail.statistics.isEmpty {
            TournamentEmptySectionView(
                title: "Stats are not available yet",
                systemImage: "chart.bar"
            )
        } else {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    Text("Leaderboard")
                        .font(.headline)

                    Spacer(minLength: 8)

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
            .accessibilityIdentifier("tournament.stats")
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

private struct TournamentStatisticTableView: View {
    let table: TournamentStatisticTable
    let columns: [TournamentStatisticColumn]

    var body: some View {
        TournamentDetailCard {
            if table.rows.isEmpty {
                AppEmptyStateView(
                    title: "No statistics recorded",
                    message: "Rankings will appear when official results are available.",
                    systemImage: "chart.bar"
                )
            } else {
                ScrollView(.horizontal, showsIndicators: true) {
                    VStack(spacing: 0) {
                        header
                        Divider()

                        ForEach(table.rows) { row in
                            statisticRow(row)
                            if row.id != table.rows.last?.id {
                                Divider()
                            }
                        }
                    }
                    .padding(.bottom, 2)
                }
            }
        }
        .accessibilityIdentifier("tournament.stats.table.\(table.id)")
    }

    private var header: some View {
        HStack(spacing: 0) {
            Text("Rank")
                .frame(width: 44, alignment: .leading)
            Text(table.subjectType == "team" ? "Team" : "Player")
                .frame(width: AppLayout.tableSubjectWidth, alignment: .leading)

            ForEach(columns) { column in
                Text(column.label)
                    .frame(width: AppLayout.tableValueWidth, alignment: .trailing)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
        .padding(.vertical, 8)
    }

    private func statisticRow(_ row: TournamentStatisticRow) -> some View {
        HStack(spacing: 0) {
            Text("\(row.rank)")
                .foregroundStyle(.secondary)
                .frame(width: 44, alignment: .leading)

            Text(row.subject.label)
                .fontWeight(.medium)
                .frame(width: AppLayout.tableSubjectWidth, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)

            ForEach(columns) { column in
                Text(formatted(row.values[column.key], as: column.valueType))
                    .font(.subheadline.monospacedDigit())
                    .frame(width: AppLayout.tableValueWidth, alignment: .trailing)
            }
        }
        .font(.subheadline)
        .padding(.vertical, 9)
        .accessibilityIdentifier("tournament.stats.row.\(row.id)")
        .accessibilityElement(children: .combine)
    }

    private func formatted(_ value: Double?, as valueType: String) -> String {
        guard let value else {
            return "-"
        }

        if valueType == "percentage" {
            return value.formatted(
                .percent.precision(.fractionLength(0...1))
            )
        }

        if value.rounded() == value {
            return Int(value).formatted()
        }

        return value.formatted(.number.precision(.fractionLength(0...2)))
    }
}
