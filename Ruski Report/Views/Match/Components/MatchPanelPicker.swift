//
//  MatchPanelPicker.swift
//  Ruski Report
//
//  Defines extensible game-center destinations and renders their metadata with
//  the shared picker rail.
//

import SwiftUI

struct MatchPanelPicker: View {
    @Binding var selection: MatchDetailPanel
    let commentCount: Int

    var body: some View {
        AppPickerRail(
            options: MatchDetailPanel.allCases,
            selection: $selection,
            title: \.title,
            systemImage: \.systemImage,
            badge: { panel in
                guard panel == .chat, commentCount > 0 else {
                    return nil
                }
                return "\(commentCount)"
            },
            accessibilityIdentifier: {
                "match.panel.\($0.rawValue)"
            }
        )
        .accessibilityIdentifier("match.panelPicker")
    }
}

enum MatchDetailPanel: String, CaseIterable, Identifiable {
    case overview
    case plays
    case scorecard
    case chat

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: "Overview"
        case .plays: "Plays"
        case .scorecard: "Scorecard"
        case .chat: "Chat"
        }
    }

    var systemImage: String {
        switch self {
        case .overview: "rectangle.grid.2x2"
        case .plays: "list.bullet.rectangle"
        case .scorecard: "tablecells"
        case .chat: "text.bubble"
        }
    }
}
