//
//  TournamentPodsView.swift
//  Ruski Report
//
//  Coordinates pod standings while delegating each pod and row to focused,
//  reusable presentation components.
//

import SwiftUI

struct TournamentPodsView: View {
    let detail: TournamentDetail

    var body: some View {
        if detail.pods.isEmpty {
            TournamentEmptySectionView(
                title: TournamentCopy.podsUnavailable,
                systemImage: "square.grid.2x2"
            )
        } else {
            VStack(alignment: .leading, spacing: AppLayout.standardSpacing) {
                AppSectionHeader(
                    TournamentCopy.podsTitle,
                    subtitle: TournamentCopy.podsSubtitle,
                    count: detail.pods.count
                )

                ForEach(detail.pods.sorted { $0.sequence < $1.sequence }) { pod in
                    TournamentPodCard(detail: detail, pod: pod)
                }
            }
        }
    }
}
