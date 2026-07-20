//
//  TournamentSectionPicker.swift
//  Ruski Report
//

import SwiftUI

struct TournamentSectionPicker: View {
    @Binding var selection: TournamentDetailSection

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(TournamentDetailSection.allCases) { section in
                    Button {
                        selection = section
                    } label: {
                        Label(section.title, systemImage: section.systemImage)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 44)
                            .foregroundStyle(
                                selection == section ? Color.white : Color.primary
                            )
                            .background(
                                selection == section ?
                                    Color.accentColor : Color.appSecondaryGroupedBackground
                            )
                            .clipShape(
                                RoundedRectangle(
                                    cornerRadius: AppLayout.surfaceRadius,
                                    style: .continuous
                                )
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("tournament.section.\(section.rawValue)")
                    .accessibilityAddTraits(selection == section ? .isSelected : [])
                }
            }
        }
        .accessibilityIdentifier("tournament.sectionPicker")
    }
}

enum TournamentDetailSection: String, CaseIterable, Identifiable {
    case overview
    case pods
    case matches
    case bracket
    case stats

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: "Overview"
        case .pods: "Pods"
        case .matches: "Matches"
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
