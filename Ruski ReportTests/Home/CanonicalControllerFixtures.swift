//
//  CanonicalControllerFixtures.swift
//  Ruski ReportTests
//

@testable import Ruski_Report

@MainActor
final class CanonicalControllerTournamentRepository: TournamentRepository {
    nonisolated struct DetailRequest: Hashable {
        let tournamentId: String
        let projectionVersion: Int64
    }

    var discoveryResults: [Result<[PublicTournamentSummary], Error>]
    var discoveryDelays: [UInt64]
    var detailResults: [DetailRequest: Result<PublicTournamentDetail, Error>]
    var detailDelays: [DetailRequest: UInt64]
    private(set) var discoveryRequestCount = 0
    private(set) var detailRequests: [DetailRequest] = []

    init(
        discoveryResults: [Result<[PublicTournamentSummary], Error>] = [],
        discoveryDelays: [UInt64] = [],
        detailResults: [DetailRequest: Result<PublicTournamentDetail, Error>] = [:],
        detailDelays: [DetailRequest: UInt64] = [:]
    ) {
        self.discoveryResults = discoveryResults
        self.discoveryDelays = discoveryDelays
        self.detailResults = detailResults
        self.detailDelays = detailDelays
    }

    func activeTournament() async throws -> TournamentPreview {
        throw AppError.unsupported("Legacy discovery is not configured.")
    }

    func tournament(id: TournamentPreview.ID) async throws -> TournamentDetail {
        throw AppError.unsupported("Legacy tournament detail is not configured.")
    }

    func matches(tournamentId: TournamentPreview.ID) async throws -> [MatchPreview] {
        throw AppError.unsupported("Legacy tournament matches are not configured.")
    }

    func activeTournaments() async throws -> [PublicTournamentSummary] {
        let index = discoveryRequestCount
        discoveryRequestCount += 1
        if index < discoveryDelays.count, discoveryDelays[index] > 0 {
            try await Task.sleep(nanoseconds: discoveryDelays[index])
        }
        guard !discoveryResults.isEmpty else {
            return []
        }
        return try discoveryResults[min(index, discoveryResults.count - 1)].get()
    }

    func tournament(
        id: PublicTournamentSummary.ID,
        projectionVersion: Int64
    ) async throws -> PublicTournamentDetail {
        let request = DetailRequest(
            tournamentId: id,
            projectionVersion: projectionVersion
        )
        detailRequests.append(request)
        if let delay = detailDelays[request], delay > 0 {
            try await Task.sleep(nanoseconds: delay)
        }
        guard let result = detailResults[request] else {
            throw AppError.unsupported("Canonical detail is not configured.")
        }
        return try result.get()
    }
}

@MainActor
final class CanonicalControllerMatchRepository: MatchRepository {
    nonisolated struct Request: Hashable {
        let matchId: String
        let tournamentId: String
        let projectionVersion: Int64
    }

    var results: [Request: Result<PublicMatchDetail, Error>]
    var delays: [Request: UInt64]
    private(set) var requests: [Request] = []

    init(
        results: [Request: Result<PublicMatchDetail, Error>] = [:],
        delays: [Request: UInt64] = [:]
    ) {
        self.results = results
        self.delays = delays
    }

    func match(id: MatchPreview.ID) async throws -> MatchDetail {
        throw AppError.unsupported("Legacy match detail is not configured.")
    }

    func match(
        id: PublicMatchSummary.ID,
        tournamentId: PublicTournamentSummary.ID,
        projectionVersion: Int64
    ) async throws -> PublicMatchDetail {
        let request = Request(
            matchId: id,
            tournamentId: tournamentId,
            projectionVersion: projectionVersion
        )
        requests.append(request)
        if let delay = delays[request], delay > 0 {
            try await Task.sleep(nanoseconds: delay)
        }
        guard let result = results[request] else {
            throw AppError.unsupported("Canonical match detail is not configured.")
        }
        return try result.get()
    }
}

func controllerTournamentSummary(
    id: String = publicTournamentId,
    version: Int64 = publicProjectionVersion,
    name: String = "Public Tournament"
) -> PublicTournamentSummary {
    PublicTournamentSummary(
        id: id,
        gameType: "ruski",
        year: 2027,
        name: name,
        lifecycle: .playoffs,
        projection: PublicProjectionReference(
            tournamentId: id,
            version: version,
            activatedAt: "2027-06-21T18:00:00.000Z"
        )
    )
}

func controllerTournamentDetail(
    summary: PublicTournamentSummary = controllerTournamentSummary()
) -> PublicTournamentDetail {
    let source = try! PublicTournamentMapper.detail(
        from: PublicTournamentDetailEnvelopeDTO(
            contractVersion: 2,
            projection: publicProjectionDTO(),
            tournament: publicTournamentDTO()
        ),
        expectedTournamentId: publicTournamentId,
        expectedVersion: publicProjectionVersion
    )
    let matches = source.matches.map {
        controllerMatchSummary(source: $0, projection: summary.projection)
    }
    return PublicTournamentDetail(
        id: summary.id,
        gameType: summary.gameType,
        year: summary.year,
        name: summary.name,
        lifecycle: summary.lifecycle,
        projection: summary.projection,
        format: source.format,
        rosters: source.rosters,
        pods: source.pods,
        seeds: source.seeds,
        statistics: source.statistics,
        matches: matches,
        bracket: source.bracket
    )
}

func controllerMatchDetail(
    version: Int64 = publicProjectionVersion
) -> PublicMatchDetail {
    let source = try! PublicMatchMapper.detail(
        from: PublicMatchDetailEnvelopeDTO(
            contractVersion: 2,
            projection: publicProjectionDTO(),
            match: publicMatchDTO()
        ),
        expectedTournamentId: publicTournamentId,
        expectedMatchId: "match-pod-1",
        expectedVersion: publicProjectionVersion
    )
    let projection = PublicProjectionReference(
        tournamentId: publicTournamentId,
        version: version,
        activatedAt: "2027-06-21T18:00:00.000Z"
    )
    return PublicMatchDetail(
        id: source.id,
        summary: controllerMatchSummary(
            source: source.summary,
            projection: projection
        ),
        events: source.events,
        statistics: source.statistics,
        boxScore: source.boxScore,
        scorecard: source.scorecard
    )
}

private func controllerMatchSummary(
    source: PublicMatchSummary,
    projection: PublicProjectionReference
) -> PublicMatchSummary {
    PublicMatchSummary(
        id: source.id,
        tournamentId: projection.tournamentId,
        projection: projection,
        stage: source.stage,
        sequence: source.sequence,
        podId: source.podId,
        bracketMatchId: source.bracketMatchId,
        instance: source.instance,
        revision: source.revision,
        status: source.status,
        scoreAvailability: source.scoreAvailability,
        correction: source.correction,
        timestamps: source.timestamps,
        participants: source.participants,
        winner: source.winner
    )
}

func canonicalRealtimeUpdate(
    type: RealtimeUpdateType = .tournamentUpdated,
    tournamentId: String = publicTournamentId,
    matchId: String? = nil,
    projectionVersion: Int64?
) -> RealtimeUpdate {
    RealtimeUpdate(
        id: "canonical-live-\(projectionVersion.map { String($0) } ?? "absent")",
        type: type,
        tournamentId: tournamentId,
        matchId: matchId,
        occurredAt: "2027-06-21T19:00:00.000Z",
        version: nil,
        projectionVersion: projectionVersion,
        metadata: nil
    )
}
