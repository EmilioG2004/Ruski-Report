//
//  HomeView.swift
//  Ruski Report
//
//  Owns the home screen shell and connects declarative score content to the
//  shared application router.
//

import SwiftUI

struct HomeView: View {
    let state: HomeViewState
    let retry: () async -> Void

    @EnvironmentObject private var navigation: AppNavigationController

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: AppLayout.sectionSpacing) {
                HomeScreenHeader()
                HomeStateContentView(
                    state: state,
                    retry: retry,
                    openTournament: openTournament,
                    openMatch: openMatch
                )
            }
            .padding(AppLayout.pagePadding)
            .frame(
                maxWidth: AppLayout.maximumContentWidth,
                alignment: .leading
            )
            .frame(maxWidth: .infinity)
        }
        .background(Color.appGroupedBackground)
        .navigationTitle(HomeCopy.navigationTitle)
        .appInlineNavigationTitle()
        .toolbar {
            ToolbarItem(placement: historyToolbarPlacement) {
                Button {
                    navigation.showTournamentHistory()
                } label: {
                    Label("Tournament history", systemImage: "clock.arrow.circlepath")
                }
                .accessibilityIdentifier("history.toolbar")
            }
        }
        .refreshable {
            await retry()
        }
        .tint(Color.appBrand)
    }

    private func openTournament(_ tournament: TournamentPreview) {
        navigation.showTournament(tournament)
    }

    private func openMatch(_ match: MatchPreview, in detail: TournamentDetail) {
        navigation.showMatch(match, in: detail)
    }

    private var historyToolbarPlacement: ToolbarItemPlacement {
        #if os(macOS)
        .automatic
        #else
        .topBarLeading
        #endif
    }
}
