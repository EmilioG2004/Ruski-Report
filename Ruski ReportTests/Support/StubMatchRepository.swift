//
//  StubMatchRepository.swift
//  Ruski ReportTests
//

@testable import Ruski_Report

final class StubMatchRepository: MatchRepository {
    private let matchResult: Result<MatchDetail, Error>
    private(set) var requestedMatchIds: [MatchPreview.ID] = []

    init(
        matchResult: Result<MatchDetail, Error> = .success(
            PreviewData.matchDetail
        )
    ) {
        self.matchResult = matchResult
    }

    func match(id: MatchPreview.ID) async throws -> MatchDetail {
        requestedMatchIds.append(id)
        return try matchResult.get()
    }
}
