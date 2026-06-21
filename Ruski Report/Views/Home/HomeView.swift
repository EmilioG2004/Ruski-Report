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
            VStack(alignment: .leading, spacing: 24) {
                header
                content
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.appGroupedBackground)
        .navigationTitle("Ruski Report")
        .appLargeNavigationTitle()
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .idle, .loading:
            HomeLoadingView()
        case .loaded(let tournament):
            TournamentCardView(tournament: tournament) {
                navigation.showTournament(tournament)
            }
        case .failed(let message):
            HomeErrorView(message: message) {
                Task {
                    await retry()
                }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Ruski Report")
                .font(.largeTitle.bold())
                .accessibilityIdentifier("home.title")

            Text("Official tournament viewer")
                .font(.headline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct HomeLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ProgressView()
                .controlSize(.large)

            Text("Loading active tournament")
                .font(.headline)

            Text("Fetching the latest official tournament summary.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .homeStatePanel()
        .accessibilityIdentifier("home.loading")
    }
}

private struct HomeErrorView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.title2)
                .foregroundStyle(.orange)

            Text("Tournament unavailable")
                .font(.headline)

            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Button(action: retry) {
                Label("Retry", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("home.retry")
        }
        .homeStatePanel()
        .accessibilityIdentifier("home.error")
    }
}

private extension View {
    func homeStatePanel() -> some View {
        frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .background(Color.appSecondaryGroupedBackground)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color.appSeparator, lineWidth: 0.5)
            }
    }
}
