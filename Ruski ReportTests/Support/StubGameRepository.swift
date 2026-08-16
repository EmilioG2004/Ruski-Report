//
//  StubGameRepository.swift
//  Ruski ReportTests
//

@testable import Ruski_Report

final class StubGameRepository: GameRepository {
    private let gamesResult: Result<[GameDefinition], Error>

    init(
        gamesResult: Result<[GameDefinition], Error> = .success(
            [PreviewData.gameDefinition]
        )
    ) {
        self.gamesResult = gamesResult
    }

    func games() async throws -> [GameDefinition] {
        try gamesResult.get()
    }
}
