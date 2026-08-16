//
//  TournamentDetailComponents.swift
//  Ruski Report
//

import SwiftUI

struct TournamentDetailCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        AppSurface {
            content
        }
    }
}

struct TournamentMetricView: View {
    let title: String
    let value: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .frame(width: 28, height: 28)
                .foregroundStyle(Color.accentColor)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text(value)
                    .font(.body.weight(.medium))
            }

            Spacer(minLength: 0)
        }
    }
}

struct TournamentEmptySectionView: View {
    let title: String
    let systemImage: String

    var body: some View {
        AppEmptyStateView(title: title, systemImage: systemImage)
    }
}
