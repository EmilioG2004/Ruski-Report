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

    init(status: TournamentPreviewStatus) {
        text = status.displayName
        switch status {
        case .active: style = .live
        case .completed: style = .final
        case .scheduled: style = .scheduled
        case .archived, .unknown: style = .neutral
        }
    }

    init(status: MatchStatus) {
        text = status.displayName
        style = Style(status: status)
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

        init(status: MatchStatus) {
            switch status {
            case .inProgress: self = .live
            case .final: self = .final
            case .scheduled: self = .scheduled
            case .unknown: self = .neutral
            }
        }

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

struct StatusMetadataLine: View {
    let statusText: String
    let style: StatusPill.Style
    let metadata: String?

    init(status: MatchStatus, metadata: String?) {
        statusText = status.displayName
        style = StatusPill.Style(status: status)
        self.metadata = metadata
    }

    init(text: String, style: StatusPill.Style, metadata: String?) {
        statusText = text
        self.style = style
        self.metadata = metadata
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                status
                Spacer(minLength: 8)
                metadataText
            }

            VStack(alignment: .leading, spacing: 8) {
                status
                metadataText
            }
        }
    }

    private var status: some View {
        StatusPill(text: statusText, style: style)
    }

    @ViewBuilder
    private var metadataText: some View {
        if let metadata {
            Text(metadata)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
