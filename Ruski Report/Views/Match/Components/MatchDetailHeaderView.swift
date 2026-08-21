//
//  MatchDetailHeaderView.swift
//  Ruski Report
//
//  Keeps game context and extensible destinations reachable. Accessibility
//  sizes scroll the context within a bounded region instead of crushing the
//  destination rail or the selected panel below it.
//

import SwiftUI

struct MatchDetailHeaderView: View {
    let screen: MatchDetailScreen
    let routeContext: MatchRouteContext
    let availableHeight: CGFloat
    @Binding var selection: MatchDetailPanel

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.contentSpacing) {
            scoreHeader

            MatchPanelPicker(
                selection: $selection,
                commentCount: screen.match.commentsSummary?.count ?? 0
            )
        }
        .padding(AppLayout.pagePadding)
        .frame(
            maxWidth: AppLayout.maximumContentWidth,
            alignment: .leading
        )
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var scoreHeader: some View {
        if dynamicTypeSize.isAccessibilitySize {
            ScrollView {
                matchScoreHeader
            }
            .frame(maxHeight: accessibilityHeaderHeight)
        } else {
            matchScoreHeader
        }
    }

    private var matchScoreHeader: some View {
        MatchScoreHeaderView(
            screen: screen,
            routeContext: routeContext
        )
    }

    private var accessibilityHeaderHeight: CGFloat {
        availableHeight * AppLayout.matchHeaderAccessibilityHeightFraction
    }
}
