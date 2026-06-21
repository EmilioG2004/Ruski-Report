//
//  RealtimeUpdateRepository.swift
//  Ruski Report
//

import Foundation

nonisolated protocol RealtimeUpdateRepository {
    func updates() -> AsyncStream<RealtimeUpdate>
}
