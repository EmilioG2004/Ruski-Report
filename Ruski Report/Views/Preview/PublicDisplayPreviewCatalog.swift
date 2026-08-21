//
//  PublicDisplayPreviewCatalog.swift
//  Ruski Report
//
//  Canonical public-projection previews. Every value is deterministic and
//  sanitized in PublicDisplayFixtures.
//

import SwiftUI

#Preview("Public Home · Zero · Compact") {
    NavigationStack {
        HomeView(
            state: .canonicalLoaded(PublicDisplayFixtures.homeZero),
            retry: {}
        )
        .environmentObject(AppNavigationController())
    }
    .previewDevice(PreviewDevice(rawValue: "iPhone SE (3rd generation)"))
}

#Preview("Public Home · Two · Large Dark") {
    NavigationStack {
        HomeView(
            state: .canonicalLoaded(PublicDisplayFixtures.homeTwo),
            retry: {}
        )
        .environmentObject(AppNavigationController())
    }
    .preferredColorScheme(.dark)
    .previewDevice(PreviewDevice(rawValue: "iPhone 16 Pro Max"))
}

#Preview("Public Tournament · All States") {
    PublicTournamentDisplayPreview(
        detail: PublicDisplayFixtures.tournamentDetail,
        selectedSection: .matches
    )
    .environmentObject(AppNavigationController())
    .previewDevice(PreviewDevice(rawValue: "iPhone SE (3rd generation)"))
}

#Preview("Public Tournament · Empty Bracket") {
    PublicTournamentDisplayPreview(
        detail: PublicDisplayFixtures.emptyBracketTournamentDetail,
        selectedSection: .bracket
    )
    .environmentObject(AppNavigationController())
    .previewDevice(PreviewDevice(rawValue: "iPhone 16 Pro Max"))
}

#Preview("Public Tournament · Long · XXXL Dark") {
    PublicTournamentDisplayPreview(
        detail: PublicDisplayFixtures.longContentTournamentDetail,
        selectedSection: .overview
    )
    .environmentObject(AppNavigationController())
    .environment(\.dynamicTypeSize, .accessibility5)
    .preferredColorScheme(.dark)
    .previewDevice(PreviewDevice(rawValue: "iPhone 16 Pro Max"))
}

#Preview("Public Match · Historical Roster") {
    if let detail = PublicDisplayFixtures.matchDetailsById["public-final-complete"] {
        PublicMatchDisplayPreview(detail: detail)
            .previewDevice(PreviewDevice(rawValue: "iPhone SE (3rd generation)"))
    }
}

#Preview("Public Match · Final Unrecorded · XXXL") {
    if let detail = PublicDisplayFixtures.matchDetailsById["public-final-unrecorded"] {
        PublicMatchDisplayPreview(detail: detail)
            .environment(\.dynamicTypeSize, .accessibility5)
            .previewDevice(PreviewDevice(rawValue: "iPhone 16 Pro Max"))
    }
}

private struct PublicTournamentDisplayPreview: View {
    let detail: PublicTournamentDetail
    @State private var selectedSection: TournamentDetailSection

    init(
        detail: PublicTournamentDetail,
        selectedSection: TournamentDetailSection
    ) {
        self.detail = detail
        _selectedSection = State(initialValue: selectedSection)
    }

    var body: some View {
        NavigationStack {
            PublicTournamentDetailContentView(
                detail: detail,
                selectedSection: $selectedSection
            )
            .background(Color.appGroupedBackground)
            .navigationTitle("Tournament")
            .appInlineNavigationTitle()
        }
    }
}

private struct PublicMatchDisplayPreview: View {
    let detail: PublicMatchDetail
    @State private var selectedPanel: MatchDetailPanel = .overview

    var body: some View {
        NavigationStack {
            GeometryReader { proxy in
                VStack(spacing: 0) {
                    PublicMatchDetailHeaderView(
                        detail: detail,
                        availableHeight: proxy.size.height,
                        selection: $selectedPanel
                    )

                    Divider()

                    MatchPanelScrollView {
                        PublicMatchOverviewPanel(detail: detail)
                    }
                }
            }
            .background(Color.appGroupedBackground)
            .navigationTitle("Game")
            .appInlineNavigationTitle()
        }
    }
}
