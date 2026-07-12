//
//  RealtimeUpdate.swift
//  Ruski Report
//

import Foundation

nonisolated struct RealtimeUpdate: Decodable, Equatable {
    let id: String
    let type: RealtimeUpdateType
    let tournamentId: String?
    let matchId: String?
    let occurredAt: String
    let version: Int?
    let metadata: [String: JSONValue]?
}

nonisolated enum RealtimeUpdateType: Equatable {
    case tournamentUpdated
    case matchUpdated
    case commentsUpdated
    case connectionReady
    case error
    case unknown(String)

    var rawValue: String {
        switch self {
        case .tournamentUpdated:
            "tournament.updated"
        case .matchUpdated:
            "match.updated"
        case .commentsUpdated:
            "comments.updated"
        case .connectionReady:
            "connection.ready"
        case .error:
            "error"
        case .unknown(let value):
            value
        }
    }
}

extension RealtimeUpdateType: Decodable {
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)

        switch value {
        case "tournament.updated":
            self = .tournamentUpdated
        case "match.updated":
            self = .matchUpdated
        case "comments.updated":
            self = .commentsUpdated
        case "connection.ready":
            self = .connectionReady
        case "error":
            self = .error
        default:
            self = .unknown(value)
        }
    }
}

nonisolated struct RealtimeSubscription: Equatable {
    let scope: RealtimeSubscriptionScope
    let tournamentId: String?
    let matchId: String?

    static let all = RealtimeSubscription(
        scope: .all,
        tournamentId: nil,
        matchId: nil
    )

    static func tournament(id: String) -> RealtimeSubscription {
        RealtimeSubscription(
            scope: .tournament,
            tournamentId: id,
            matchId: nil
        )
    }

    static func match(
        tournamentId: String?,
        matchId: String
    ) -> RealtimeSubscription {
        RealtimeSubscription(
            scope: .match,
            tournamentId: tournamentId,
            matchId: matchId
        )
    }
}

nonisolated enum RealtimeSubscriptionScope: String, Equatable {
    case all
    case tournament
    case match
}
