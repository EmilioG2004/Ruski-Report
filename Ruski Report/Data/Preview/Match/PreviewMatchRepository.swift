//
//  PreviewMatchRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class PreviewMatchRepository: MatchRepository {
    private let matchDetail: MatchDetail
    private let publicMatchDetails: [String: PublicMatchDetail]

    init(
        matchDetail: MatchDetail = PreviewData.matchDetail,
        publicMatchDetails: [String: PublicMatchDetail] = PublicDisplayFixtures.matchDetailsById
    ) {
        self.matchDetail = matchDetail
        self.publicMatchDetails = publicMatchDetails
    }

    func match(id: MatchPreview.ID) async throws -> MatchDetail {
        guard id == matchDetail.id else {
            throw AppError.badStatus(code: 404, message: "Match not found.")
        }

        return matchDetail
    }

    func match(
        id: PublicMatchSummary.ID,
        tournamentId: PublicTournamentSummary.ID,
        projectionVersion: Int64
    ) async throws -> PublicMatchDetail {
        guard let detail = publicMatchDetails[id],
              detail.summary.tournamentId == tournamentId,
              detail.summary.projection.version == projectionVersion else {
            throw AppError.badStatus(code: 404, message: "Match not found.")
        }
        return detail
    }
}
