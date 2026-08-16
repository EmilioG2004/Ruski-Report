//
//  MatchBoxScoreView.swift
//  Ruski Report
//

import SwiftUI

struct MatchBoxScoreView: View {
    let screen: MatchDetailScreen

    var body: some View {
        MatchSectionView(title: "Box Score", systemImage: "chart.bar.xaxis") {
            if let boxScore = screen.match.boxScore,
               !screen.boxScoreColumns.isEmpty {
                ScrollView(.horizontal, showsIndicators: true) {
                    Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 12) {
                        GridRow {
                            Text("Player")
                                .boxScoreHeaderStyle(
                                    width: AppLayout.tableSubjectWidth,
                                    alignment: .leading
                                )

                            ForEach(screen.boxScoreColumns) { column in
                                Text(column.label)
                                    .boxScoreHeaderStyle(
                                        width: AppLayout.tableValueWidth,
                                        alignment: .trailing
                                    )
                            }
                        }

                        ForEach(boxScore.rows) { row in
                            GridRow {
                                Text(row.label)
                                    .font(.subheadline.weight(.medium))
                                    .fixedSize(horizontal: false, vertical: true)
                                    .frame(
                                        width: AppLayout.tableSubjectWidth,
                                        alignment: .leading
                                    )

                                ForEach(screen.boxScoreColumns) { column in
                                    valueCell(row.stats[column.key], column: column)
                                }
                            }
                        }

                        if !boxScore.totals.isEmpty {
                            GridRow {
                                Text("Total")
                                    .font(.subheadline.weight(.bold))
                                    .frame(
                                        width: AppLayout.tableSubjectWidth,
                                        alignment: .leading
                                    )

                                ForEach(screen.boxScoreColumns) { column in
                                    valueCell(boxScore.totals[column.key], column: column)
                                        .fontWeight(.bold)
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

    private func valueCell(
        _ value: Double?,
        column: BoxScoreStatColumn
    ) -> some View {
        Text(MatchValueFormatter.stat(value, valueType: column.valueType))
            .font(.subheadline.monospacedDigit())
            .frame(width: AppLayout.tableValueWidth, alignment: .trailing)
    }
}
