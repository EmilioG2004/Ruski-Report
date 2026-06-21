//
//  RealtimeUpdate.swift
//  Ruski Report
//

import Foundation

nonisolated struct RealtimeUpdate: Equatable {
    let id: String
    let type: String
    let tournamentId: String?
    let matchId: String?
    let occurredAt: String
}
