//
//  SocketIOFrame.swift
//  Ruski Report
//

import Foundation

nonisolated enum SocketIOFrame: Equatable {
    case engineOpen
    case enginePing
    case namespaceConnected
    case liveUpdate(RealtimeUpdate)
    case ignored

    static let namespaceConnect = "40/live,"
    static let pong = "3"

    static func subscribe(subscription: RealtimeSubscription) throws -> String {
        try event(
            name: "subscribe",
            payload: SocketIOSubscriptionPayload(subscription: subscription)
        )
    }

    static func parse(
        _ message: String,
        decoder: JSONDecoder = JSONDecoder()
    ) throws -> SocketIOFrame {
        if message == "2" {
            return .enginePing
        }

        if message.hasPrefix("0") {
            return .engineOpen
        }

        if message.hasPrefix("40/live") {
            return .namespaceConnected
        }

        let eventPrefix = "42/live,"
        guard message.hasPrefix(eventPrefix) else {
            return .ignored
        }

        let payload = String(message.dropFirst(eventPrefix.count))
        let data = Data(payload.utf8)
        let event = try decoder.decode(SocketIOInboundEvent.self, from: data)

        guard event.name == "live.update", let update = event.update else {
            return .ignored
        }

        return .liveUpdate(update)
    }

    private static func event<Payload: Encodable>(
        name: String,
        payload: Payload
    ) throws -> String {
        let data = try JSONEncoder().encode(
            SocketIOOutboundEvent(name: name, payload: payload)
        )

        guard let body = String(data: data, encoding: .utf8) else {
            throw AppError.encodingFailed("Unable to encode realtime event.")
        }

        return "42/live,\(body)"
    }
}

nonisolated private struct SocketIOOutboundEvent<Payload: Encodable>: Encodable {
    let name: String
    let payload: Payload

    func encode(to encoder: Encoder) throws {
        var container = encoder.unkeyedContainer()
        try container.encode(name)
        try container.encode(payload)
    }
}

nonisolated private struct SocketIOSubscriptionPayload: Encodable {
    let scope: String
    let tournamentId: String?
    let matchId: String?

    init(subscription: RealtimeSubscription) {
        self.scope = subscription.scope.rawValue
        self.tournamentId = subscription.tournamentId
        self.matchId = subscription.matchId
    }
}

nonisolated private struct SocketIOInboundEvent: Decodable {
    let name: String
    let update: RealtimeUpdate?

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        self.name = try container.decode(String.self)

        if name == "live.update" {
            self.update = try container.decode(RealtimeUpdate.self)
        } else {
            self.update = nil
        }
    }
}
