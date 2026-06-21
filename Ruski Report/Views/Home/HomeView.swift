//
//  HomeView.swift
//  Ruski Report
//

import SwiftUI

struct HomeView: View {
    let tournament: TournamentPreview

    @EnvironmentObject private var navigation: AppNavigationController

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                TournamentCardView(tournament: tournament) {
                    navigation.showTournament(tournament)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.appGroupedBackground)
        .navigationTitle("Ruski Report")
        .appLargeNavigationTitle()
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
