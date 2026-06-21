//
//  TournamentPreviewStore.swift
//  Ruski Report
//

import Foundation

struct TournamentPreviewStore {
    private let tournaments: [TournamentPreview]

    init(tournaments: [TournamentPreview] = [.official2026]) {
        self.tournaments = tournaments
    }

    var featuredTournament: TournamentPreview {
        tournaments[0]
    }

    func tournament(id: TournamentPreview.ID) -> TournamentPreview? {
        tournaments.first { $0.id == id }
    }
}

private extension TournamentPreview {
    static let official2026 = TournamentPreview(
        id: "tournament-2026",
        year: 2026,
        name: "2026 Ruski Tournament",
        status: .scheduled,
        formatSummary: "Pod play and championship bracket",
        locationName: "Durham Ruski Club",
        featuredMatchCount: 0
    )
}
