//
//  HomeViewState.swift
//  Ruski Report
//

nonisolated enum HomeViewState: Equatable {
    case idle
    case loading
    case loaded(TournamentPreview)
    case failed(message: String)

    var tournament: TournamentPreview? {
        guard case .loaded(let tournament) = self else {
            return nil
        }

        return tournament
    }
}
