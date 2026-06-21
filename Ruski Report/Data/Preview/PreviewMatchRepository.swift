//
//  PreviewMatchRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class PreviewMatchRepository: MatchRepository {
    private let matchDetail: MatchDetail

    init(matchDetail: MatchDetail = PreviewData.matchDetail) {
        self.matchDetail = matchDetail
    }

    func match(id: MatchPreview.ID) async throws -> MatchDetail {
        guard id == matchDetail.id else {
            throw AppError.badStatus(code: 404, message: "Match not found.")
        }

        return matchDetail
    }
}
