//
//  TournamentHistoryViewState.swift
//  Ruski Report
//

nonisolated enum TournamentHistoryViewState: Equatable {
    case idle
    case loading
    case loaded([PublicTournamentSummary])
    case failed(message: String)
}
