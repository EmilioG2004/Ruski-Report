//
//  MatchValueFormatter.swift
//  Ruski Report
//
//  Centralizes server-driven score and scorecard value formatting, along with
//  the header styles shared by their horizontally scalable tables.
//

import Foundation
import SwiftUI

enum MatchValueFormatter {
    static func stat(_ value: Double?, valueType: String) -> String {
        guard let value else { return "-" }
        return valueType == "percentage" ? "\(number(value * 100))%" : number(value)
    }

    static func bool(_ value: String?) -> Bool {
        guard let value else { return false }

        return switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "true", "yes", "1": true
        default: false
        }
    }

    private static func number(_ value: Double) -> String {
        guard value.isFinite else { return "-" }
        return value.rounded() == value ? "\(Int(value))" : String(format: "%.1f", value)
    }
}

extension Text {
    func boxScoreHeaderStyle(width: CGFloat, alignment: Alignment) -> some View {
        matchTableHeaderStyle(width: width, alignment: alignment)
    }

    func scorecardHeaderStyle(width: CGFloat, alignment: Alignment) -> some View {
        matchTableHeaderStyle(width: width, alignment: alignment)
    }

    private func matchTableHeaderStyle(
        width: CGFloat,
        alignment: Alignment
    ) -> some View {
        font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .lineLimit(2)
            .fixedSize(horizontal: false, vertical: true)
            .frame(width: width, alignment: alignment)
    }
}
