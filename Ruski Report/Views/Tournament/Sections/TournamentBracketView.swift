//
//  TournamentBracketView.swift
//  Ruski Report
//
//  Coordinates the horizontal bracket while round and matchup components own
//  their individual presentation concerns.
//

import SwiftUI

struct TournamentBracketView: View {
    @EnvironmentObject private var navigation: AppNavigationController

    let detail: TournamentDetail

    var body: some View {
        let sections = detail.bracketRoundSections()

        if sections.isEmpty {
            TournamentEmptySectionView(
                title: TournamentCopy.bracketUnavailable,
                systemImage: "rectangle.grid.2x2"
            )
        } else {
            VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
                AppSectionHeader(
                    TournamentCopy.bracketTitle,
                    subtitle: TournamentCopy.bracketSubtitle,
                    count: sections.count
                )

                ScrollView(.horizontal, showsIndicators: true) {
                    LazyHStack(alignment: .top, spacing: AppLayout.largeSpacing) {
                        ForEach(sections) { section in
                            TournamentBracketRoundSectionView(
                                detail: detail,
                                section: section,
                                openMatch: { match in
                                    navigation.showMatch(match, in: detail)
                                }
                            )
                            .frame(width: AppLayout.bracketRoundWidth)
                        }
                    }
                    .padding(.bottom, AppLayout.smallSpacing)
                }
                .accessibilityIdentifier("tournament.bracket")
            }
        }
    }
}
