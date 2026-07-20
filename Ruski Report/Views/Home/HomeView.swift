//
//  HomeView.swift
//  Ruski Report
//

import SwiftUI

struct HomeView: View {
    let state: HomeViewState
    let retry: () async -> Void

    @EnvironmentObject private var navigation: AppNavigationController

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: AppLayout.sectionSpacing) {
                Text("Official Tournament")
                    .font(.title2.bold())
                    .accessibilityIdentifier("home.title")

                content
            }
            .padding(AppLayout.pagePadding)
            .frame(
                maxWidth: AppLayout.maximumContentWidth,
                alignment: .leading
            )
            .frame(maxWidth: .infinity)
        }
        .background(Color.appGroupedBackground)
        .navigationTitle("Ruski Report")
        .appLargeNavigationTitle()
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .idle, .loading:
            AppSurface {
                AppLoadingStateView(
                    title: "Loading tournament",
                    message: "Fetching the latest official tournament summary."
                )
                .frame(minHeight: 180)
            }
            .accessibilityIdentifier("home.loading")
        case .loaded(let tournament):
            TournamentCardView(tournament: tournament) {
                navigation.showTournament(tournament)
            }
        case .failed(let message):
            AppSurface {
                AppErrorStateView(
                    title: "Tournament unavailable",
                    message: message
                ) {
                    Task {
                        await retry()
                    }
                }
                .frame(minHeight: 220)
            }
            .accessibilityIdentifier("home.error")
        }
    }
}
