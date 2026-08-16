//
//  RealtimeUpdateRepository.swift
//  Ruski Report
//

import Foundation

nonisolated protocol RealtimeUpdateRepository {
    func updates(subscription: RealtimeSubscription) -> AsyncStream<RealtimeUpdate>
}

extension RealtimeUpdateRepository {
    func updates() -> AsyncStream<RealtimeUpdate> {
        updates(subscription: .all)
    }
}
