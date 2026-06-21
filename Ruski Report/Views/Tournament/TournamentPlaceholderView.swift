//
//  TournamentPlaceholderView.swift
//  Ruski Report
//

import SwiftUI

struct TournamentPlaceholderView: View {
    let tournament: TournamentPreview?

    var body: some View {
        Group {
            if let tournament {
                tournamentContent(tournament)
            } else {
                ContentUnavailableView(
                    "Tournament Not Found",
                    systemImage: "exclamationmark.triangle"
                )
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Tournament")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func tournamentContent(_ tournament: TournamentPreview) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(tournament.name)
                        .font(.title.bold())

                    Text(tournament.formatSummary)
                        .font(.headline)
                        .foregroundStyle(.secondary)
                }

                VStack(spacing: 12) {
                    TournamentInfoRow(
                        title: "Status",
                        value: tournament.status.displayName,
                        systemImage: "flag"
                    )
                    TournamentInfoRow(
                        title: "Season",
                        value: "\(tournament.year)",
                        systemImage: "calendar"
                    )
                    TournamentInfoRow(
                        title: "Location",
                        value: tournament.locationName,
                        systemImage: "mappin.and.ellipse"
                    )
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct TournamentInfoRow: View {
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

            Spacer()
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}
