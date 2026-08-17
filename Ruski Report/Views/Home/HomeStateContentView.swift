//
//  HomeStateContentView.swift
//  Ruski Report
//
//  Maps the home controller state to stable loading, loaded, and failure
//  surfaces while delegating loaded composition to HomeScoreFeedView.
//

import SwiftUI

struct HomeStateContentView: View {
    let state: HomeViewState
    let retry: () async -> Void
    let openTournament: (TournamentPreview) -> Void
    let openMatch: (MatchPreview, TournamentDetail) -> Void

    var body: some View {
        Group {
            switch state {
            case .idle, .loading:
                loadingView
            case .loaded(let screen):
                HomeScoreFeedView(
                    screen: screen,
                    openTournament: openTournament,
                    openMatch: openMatch
                )
            case .failed(let message):
                failureView(message)
            }
        }
    }

    private var loadingView: some View {
        AppSurface {
            AppLoadingStateView(
                title: HomeCopy.loadingTitle,
                message: HomeCopy.loadingMessage
            )
            .frame(minHeight: AppLayout.compactStateHeight)
        }
        .accessibilityIdentifier("home.loading")
    }

    private func failureView(_ message: String) -> some View {
        AppSurface {
            AppErrorStateView(title: HomeCopy.errorTitle, message: message) {
                Task { await retry() }
            }
            .frame(minHeight: AppLayout.standardStateHeight)
        }
        .accessibilityIdentifier("home.error")
    }
}
