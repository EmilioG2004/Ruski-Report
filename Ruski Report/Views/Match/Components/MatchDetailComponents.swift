//
//  MatchDetailComponents.swift
//  Ruski Report
//

import Foundation
import SwiftUI

struct MatchSectionView<Content: View>: View {
    let title: String
    let systemImage: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: systemImage)
                .font(.headline)

            AppSurface {
                content
            }
        }
    }
}

struct EmptyMatchSectionView: View {
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

enum MatchValueFormatter {
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

        return switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "true", "yes", "1": true
        default: false
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

extension Text {
    func boxScoreHeaderStyle(width: CGFloat, alignment: Alignment) -> some View {
        font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .lineLimit(2)
            .fixedSize(horizontal: false, vertical: true)
            .frame(width: width, alignment: alignment)
    }

    func scorecardHeaderStyle(
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
