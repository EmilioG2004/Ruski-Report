//
//  StatusPill.swift
//  Ruski Report
//

import SwiftUI

struct StatusPill: View {
    let text: String
    let style: Style

    init(text: String, style: Style = .neutral) {
        self.text = text
        self.style = style
    }

    var body: some View {
        Label(text, systemImage: style.systemImage)
            .font(.caption.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(style.color.opacity(0.14))
            .foregroundStyle(style.color)
            .clipShape(Capsule())
            .accessibilityLabel(style.accessibilityLabel(for: text))
    }

    enum Style {
        case live
        case final
        case scheduled
        case neutral

        fileprivate var color: Color {
            switch self {
            case .live: .appLive
            case .final: .appFinal
            case .scheduled, .neutral: .secondary
            }
        }

        fileprivate var systemImage: String {
            switch self {
            case .live: "dot.radiowaves.left.and.right"
            case .final: "checkmark.circle.fill"
            case .scheduled: "clock"
            case .neutral: "circle.fill"
            }
        }

        fileprivate func accessibilityLabel(for text: String) -> String {
            switch self {
            case .live: "Live, \(text)"
            case .final, .scheduled, .neutral: text
            }
        }
    }
}
