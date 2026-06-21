//
//  StubTournamentRepository.swift
//  Ruski ReportTests
//

@testable import Ruski_Report

final class StubTournamentRepository: TournamentRepository {
    private let activeTournamentResult: Result<TournamentPreview, Error>
    private let tournamentResult: Result<TournamentDetail, Error>

    init(
        activeTournamentResult: Result<TournamentPreview, Error> = .success(
            PreviewData.tournamentPreview
        ),
        tournamentResult: Result<TournamentDetail, Error> = .success(
            PreviewData.tournamentDetail
        )
    ) {
        self.activeTournamentResult = activeTournamentResult
        self.tournamentResult = tournamentResult
    }

    func activeTournament() async throws -> TournamentPreview {
        try activeTournamentResult.get()
    }

    func tournament(id: TournamentPreview.ID) async throws -> TournamentDetail {
        try tournamentResult.get()
    }

    func matches(tournamentId: TournamentPreview.ID) async throws -> [MatchPreview] {
        try tournamentResult.get().matches
    }
}
