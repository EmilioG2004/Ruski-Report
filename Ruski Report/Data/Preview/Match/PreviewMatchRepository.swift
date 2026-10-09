//
//  PreviewMatchRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class PreviewMatchRepository: MatchRepository {
    private let matchDetail: MatchDetail
    private let publicMatchDetails: [PublicMatchDetail]

    init(
        matchDetail: MatchDetail = PreviewData.matchDetail,
        publicMatchDetails: [String: PublicMatchDetail] = PublicDisplayFixtures.matchDetailsById,
        historicalMatchDetails: [PublicMatchDetail] =
            PublicDisplayFixtures.historicalMatchDetails
    ) {
        self.matchDetail = matchDetail
        self.publicMatchDetails = Array(publicMatchDetails.values) + historicalMatchDetails
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
        guard let detail = publicMatchDetails.first(where: {
            $0.id == id &&
                $0.summary.tournamentId == tournamentId &&
                $0.summary.projection.version == projectionVersion
        }) else {
            throw AppError.badStatus(code: 404, message: "Match not found.")
        }
        return detail
    }
}
