//
//  PreviewTournamentRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class PreviewTournamentRepository: TournamentRepository {
    private let detail: TournamentDetail
    private let publicDetails: [PublicTournamentDetail]
    private let responseGate: PreviewTournamentResponseGate

    init(
        detail: TournamentDetail = PreviewData.tournamentDetail,
        publicDetails: [PublicTournamentDetail] = [PublicDisplayFixtures.tournamentDetail],
        networkCondition: PreviewNetworkCondition = .available
    ) {
        self.detail = detail
        self.publicDetails = publicDetails
        responseGate = PreviewTournamentResponseGate(
            condition: networkCondition
        )
    }

    func activeTournament() async throws -> TournamentPreview {
        try await responseGate.waitForResponse()

        return detail.preview
    }

    func tournament(id: TournamentPreview.ID) async throws -> TournamentDetail {
        try await responseGate.waitForResponse()

        guard id == detail.id else {
            throw AppError.badStatus(code: 404, message: "Tournament not found.")
        }

        return detail
    }

    func matches(tournamentId: TournamentPreview.ID) async throws -> [MatchPreview] {
        try await responseGate.waitForResponse()

        guard tournamentId == detail.id else {
            throw AppError.badStatus(code: 404, message: "Tournament not found.")
        }

        return detail.matches
    }

    func activeTournaments() async throws -> [PublicTournamentSummary] {
        try await responseGate.waitForResponse()
        return publicDetails.map(\.summary)
    }

    func tournament(
        id: PublicTournamentSummary.ID,
        projectionVersion: Int64
    ) async throws -> PublicTournamentDetail {
        try await responseGate.waitForResponse()
        guard let detail = publicDetails.first(where: {
            $0.id == id && $0.projection.version == projectionVersion
        }) else {
            throw AppError.badStatus(code: 404, message: "Tournament not found.")
        }
        return detail
    }

    func matches(
        tournamentId: PublicTournamentSummary.ID,
        projectionVersion: Int64
    ) async throws -> [PublicMatchSummary] {
        try await tournament(
            id: tournamentId,
            projectionVersion: projectionVersion
        ).matches
    }
}

private actor PreviewTournamentResponseGate {
    private let condition: PreviewNetworkCondition
    private var remainingFailures: Int?

    init(condition: PreviewNetworkCondition) {
        self.condition = condition
        remainingFailures = condition.failureLimit
    }

    func waitForResponse() async throws {
        guard let failure = condition.failure else {
            return
        }

        if let remainingFailures {
            guard remainingFailures > 0 else {
                return
            }
            self.remainingFailures = remainingFailures - 1
        }

        if condition.failureDelay > .zero {
            try await Task.sleep(for: condition.failureDelay)
        }

        throw failure
    }
}
