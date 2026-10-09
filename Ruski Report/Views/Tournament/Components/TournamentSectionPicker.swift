//
//  TournamentSectionPicker.swift
//  Ruski Report
//
//  Defines the tournament's extensible destination model and renders it with
//  the shared horizontally scrolling picker rail.
//

import SwiftUI

struct TournamentSectionPicker: View {
    @Binding var selection: TournamentDetailSection

    var body: some View {
        AppPickerRail(
            options: TournamentDetailSection.allCases,
            selection: $selection,
            title: \.title,
            systemImage: \.systemImage,
            accessibilityIdentifier: {
                "tournament.section.\($0.rawValue)"
            }
        )
        .accessibilityIdentifier("tournament.sectionPicker")
    }
}

enum TournamentDetailSection: String, CaseIterable, Identifiable {
    case matches
    case overview
    case pods
    case bracket
    case stats

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: "Overview"
        case .pods: "Pods"
        case .matches: TournamentCopy.gamesTitle
        case .bracket: "Bracket"
        case .stats: "Stats"
        }
    }

    var systemImage: String {
        switch self {
        case .overview: "rectangle.grid.2x2"
        case .pods: "person.3"
        case .matches: "sportscourt"
        case .bracket: "trophy"
        case .stats: "chart.bar"
        }
    }
}
