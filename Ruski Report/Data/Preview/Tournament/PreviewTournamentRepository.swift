//
//  PreviewTournamentRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class PreviewTournamentRepository: TournamentRepository {
    private let detail: TournamentDetail
    private let publicDetails: [PublicTournamentDetail]
    private let historicalPublicDetails: [PublicTournamentDetail]
    private let unavailablePublicDetailIds: Set<String>
    private let responseGate: PreviewTournamentResponseGate

    init(
        detail: TournamentDetail = PreviewData.tournamentDetail,
        publicDetails: [PublicTournamentDetail] = [PublicDisplayFixtures.tournamentDetail],
        historicalPublicDetails: [PublicTournamentDetail] = [
            PublicDisplayFixtures.completedTournamentDetail,
            PublicDisplayFixtures.archivedTournamentDetail
        ],
        unavailablePublicDetailIds: Set<String> = [],
        networkCondition: PreviewNetworkCondition = .available
    ) {
        self.detail = detail
        self.publicDetails = publicDetails
        self.historicalPublicDetails = historicalPublicDetails
        self.unavailablePublicDetailIds = unavailablePublicDetailIds
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

    func historicalTournaments() async throws -> [PublicTournamentSummary] {
        try await responseGate.waitForResponse()
        return historicalPublicDetails.map(\.summary)
    }

    func tournament(
        id: PublicTournamentSummary.ID,
        projectionVersion: Int64
    ) async throws -> PublicTournamentDetail {
        try await responseGate.waitForResponse()
        guard !unavailablePublicDetailIds.contains(id) else {
            throw AppError.networkUnavailable(
                "Tournament game details are temporarily unavailable."
            )
        }
        guard let detail = (publicDetails + historicalPublicDetails).first(where: {
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
