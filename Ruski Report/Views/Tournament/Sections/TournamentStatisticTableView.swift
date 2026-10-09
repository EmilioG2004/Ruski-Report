//
//  TournamentStatisticTableView.swift
//  Ruski Report
//
//  Renders a horizontally scalable leaderboard using an injected formatting
//  strategy so new statistic value types do not alter table layout code.
//

import SwiftUI

struct TournamentStatisticTableView: View {
    let table: TournamentStatisticTable
    let columns: [TournamentStatisticColumn]

    private let valueFormatter: any TournamentStatisticValueFormatting

    init(
        table: TournamentStatisticTable,
        columns: [TournamentStatisticColumn],
        valueFormatter: any TournamentStatisticValueFormatting =
            DefaultTournamentStatisticValueFormatter()
    ) {
        self.table = table
        self.columns = columns
        self.valueFormatter = valueFormatter
    }

    var body: some View {
        TournamentDetailCard {
            if table.rows.isEmpty {
                AppEmptyStateView(
                    title: TournamentCopy.noStatsTitle,
                    message: TournamentCopy.noStatsMessage,
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
                    .padding(.bottom, AppLayout.microSpacing)
                }
            }
        }
        .accessibilityIdentifier("tournament.stats.table.\(table.id)")
    }

    private var header: some View {
        HStack(spacing: 0) {
            Text("Rank")
                .frame(width: AppLayout.tableRankWidth, alignment: .leading)
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
        .padding(.vertical, AppLayout.smallSpacing)
    }

    private func statisticRow(_ row: TournamentStatisticRow) -> some View {
        HStack(spacing: 0) {
            Text("\(row.rank)")
                .foregroundStyle(.secondary)
                .frame(width: AppLayout.tableRankWidth, alignment: .leading)

            Text(row.subject.label)
                .fontWeight(.medium)
                .frame(width: AppLayout.tableSubjectWidth, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)

            ForEach(columns) { column in
                Text(valueFormatter.string(for: row.values[column.key], type: column.valueType))
                    .font(.subheadline.monospacedDigit())
                    .frame(width: AppLayout.tableValueWidth, alignment: .trailing)
            }
        }
        .font(.subheadline)
        .padding(.vertical, AppLayout.smallSpacing)
        .accessibilityIdentifier("tournament.stats.row.\(row.id)")
        .accessibilityElement(children: .combine)
    }
}
