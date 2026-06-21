//
//  AppServices.swift
//  Ruski Report
//

struct AppServices {
    let tournamentStore: TournamentPreviewStore

    static let preview = AppServices(
        tournamentStore: TournamentPreviewStore()
    )
}
