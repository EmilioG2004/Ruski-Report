//
//  MatchScorecardView.swift
//  Ruski Report
//

import SwiftUI

struct MatchScorecardView: View {
    let scorecard: Scorecard?

    var body: some View {
        MatchSectionView(title: "Scorecard", systemImage: "tablecells") {
            if let scorecard,
               !scorecard.columns.isEmpty,
               !scorecard.rows.isEmpty {
                ScrollView(.horizontal, showsIndicators: true) {
                    Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 12) {
                        GridRow {
                            ForEach(scorecard.columns) { column in
                                Text(column.label)
                                    .scorecardHeaderStyle(
                                        width: width(for: column),
                                        alignment: alignment(for: column)
                                    )
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
            let isSelected = MatchValueFormatter.bool(row.values[column.key])
            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)
                .accessibilityLabel(
                    "\(column.label) \(isSelected ? "selected" : "not selected")"
                )
        } else {
            Text(row.values[column.key] ?? "-")
                .font(.subheadline)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func width(for column: ScorecardColumn) -> CGFloat {
        switch column.dataType {
        case "boolean": AppLayout.scorecardBooleanWidth
        case "number": AppLayout.scorecardNumberWidth
        case "player": AppLayout.scorecardPlayerWidth
        default: AppLayout.scorecardDefaultWidth
        }
    }

    private func alignment(for column: ScorecardColumn) -> Alignment {
        column.dataType == "boolean" ? .center : .leading
    }
}
