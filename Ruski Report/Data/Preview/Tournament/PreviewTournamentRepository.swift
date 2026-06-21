//
//  PreviewTournamentRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class PreviewTournamentRepository: TournamentRepository {
    private let detail: TournamentDetail

    init(detail: TournamentDetail = PreviewData.tournamentDetail) {
        self.detail = detail
    }

    func activeTournament() async throws -> TournamentPreview {
        detail.preview
    }

    func tournament(id: TournamentPreview.ID) async throws -> TournamentDetail {
        guard id == detail.id else {
            throw AppError.badStatus(code: 404, message: "Tournament not found.")
        }

        return detail
    }

    func matches(tournamentId: TournamentPreview.ID) async throws -> [MatchPreview] {
        guard tournamentId == detail.id else {
            throw AppError.badStatus(code: 404, message: "Tournament not found.")
        }

        return detail.matches
    }
}
