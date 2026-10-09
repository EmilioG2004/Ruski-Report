//
//  TournamentStatisticValueFormatter.swift
//  Ruski Report
//
//  Defines the formatting strategy used by tournament statistic tables. The
//  protocol keeps rendering open to new server-defined value representations.
//

import Foundation

protocol TournamentStatisticValueFormatting {
    func string(for value: Double?, type: String) -> String
}

struct DefaultTournamentStatisticValueFormatter: TournamentStatisticValueFormatting {
    func string(for value: Double?, type: String) -> String {
        guard let value else {
            return "-"
        }

        if type == "percentage" {
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
