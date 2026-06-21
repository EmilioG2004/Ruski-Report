//
//  TournamentDetailViewState.swift
//  Ruski Report
//

nonisolated enum TournamentDetailViewState: Equatable {
    case loading
    case loaded(TournamentDetail)
    case failed(message: String)
}
