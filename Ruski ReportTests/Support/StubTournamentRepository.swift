//
//  StubTournamentRepository.swift
//  Ruski ReportTests
//

@testable import Ruski_Report

final class StubTournamentRepository: TournamentRepository {
    private let activeTournamentResult: Result<TournamentPreview, Error>
    private let tournamentResult: Result<TournamentDetail, Error>
    private(set) var activeTournamentRequestCount = 0
    private(set) var requestedTournamentIds: [TournamentPreview.ID] = []

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
        activeTournamentRequestCount += 1
        return try activeTournamentResult.get()
    }

    func tournament(id: TournamentPreview.ID) async throws -> TournamentDetail {
        requestedTournamentIds.append(id)
        return try tournamentResult.get()
    }

    func matches(tournamentId: TournamentPreview.ID) async throws -> [MatchPreview] {
        try tournamentResult.get().matches
    }
}
