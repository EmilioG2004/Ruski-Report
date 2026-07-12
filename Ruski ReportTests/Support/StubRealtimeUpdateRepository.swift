//
//  StubRealtimeUpdateRepository.swift
//  Ruski ReportTests
//

@testable import Ruski_Report

final class StubRealtimeUpdateRepository: RealtimeUpdateRepository {
    private var continuations: [AsyncStream<RealtimeUpdate>.Continuation] = []
    private(set) var subscriptions: [RealtimeSubscription] = []

    func updates(subscription: RealtimeSubscription) -> AsyncStream<RealtimeUpdate> {
        subscriptions.append(subscription)

        return AsyncStream { continuation in
            continuations.append(continuation)
        }
    }

    func send(_ update: RealtimeUpdate) {
        continuations.forEach { continuation in
            continuation.yield(update)
        }
    }

    func finish() {
        continuations.forEach { continuation in
            continuation.finish()
        }
        continuations.removeAll()
    }
}
