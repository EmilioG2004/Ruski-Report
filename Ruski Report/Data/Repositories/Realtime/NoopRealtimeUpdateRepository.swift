//
//  NoopRealtimeUpdateRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class NoopRealtimeUpdateRepository: RealtimeUpdateRepository {
    func updates(subscription: RealtimeSubscription) -> AsyncStream<RealtimeUpdate> {
        AsyncStream { continuation in
            continuation.finish()
        }
    }
}
