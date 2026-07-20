//
//  PreviewTournamentRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class PreviewTournamentRepository: TournamentRepository {
    private let detail: TournamentDetail
    private let failure: AppError?

    init(
        detail: TournamentDetail = PreviewData.tournamentDetail,
        failure: AppError? = nil
    ) {
        self.detail = detail
        self.failure = failure
    }

    func activeTournament() async throws -> TournamentPreview {
        if let failure {
            throw failure
        }

        return detail.preview
    }

    func tournament(id: TournamentPreview.ID) async throws -> TournamentDetail {
        if let failure {
            throw failure
        }

        guard id == detail.id else {
            throw AppError.badStatus(code: 404, message: "Tournament not found.")
        }

        return detail
    }

    func matches(tournamentId: TournamentPreview.ID) async throws -> [MatchPreview] {
        if let failure {
            throw failure
        }

        guard tournamentId == detail.id else {
            throw AppError.badStatus(code: 404, message: "Tournament not found.")
        }

        return detail.matches
    }
}
