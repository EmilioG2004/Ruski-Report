//
//  MatchTurnMetadataMapper.swift
//  Ruski Report
//
//  Owns the API metadata contract for turn chronology so transport keys and
//  numeric validation do not leak into views or domain projection logic.
//

import Foundation

nonisolated enum MatchTurnMetadataMapper {
    private enum Key {
        static let turnNumber = "turnNumber"
        static let teamTurnOrder = "teamTurnOrder"
        static let shotInTeamTurn = "shotInTeamTurn"
    }

    static func turnNumber(in metadata: [String: JSONValue]?) -> Int? {
        integer(for: Key.turnNumber, in: metadata)
    }

    static func teamTurnOrder(in metadata: [String: JSONValue]?) -> Int? {
        integer(for: Key.teamTurnOrder, in: metadata)
    }

    static func shotInTeamTurn(in metadata: [String: JSONValue]?) -> Int? {
        integer(for: Key.shotInTeamTurn, in: metadata)
    }

    private static func integer(
        for key: String,
        in metadata: [String: JSONValue]?
    ) -> Int? {
        guard let value = metadata?[key]?.doubleValue,
              value.isFinite,
              value.rounded() == value else {
            return nil
        }

        return Int(exactly: value)
    }
}
