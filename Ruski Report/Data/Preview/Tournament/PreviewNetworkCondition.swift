//
//  PreviewNetworkCondition.swift
//  Ruski Report
//
//  Describes deterministic network behavior for preview repositories. Keeping
//  delay and failure policy outside the UI lets qualification exercise loading,
//  outage, retry, and recovery states without changing a real network.
//

import Foundation

nonisolated struct PreviewNetworkCondition {
    let failureDelay: Duration
    let failure: AppError?
    let failureLimit: Int?

    static let available = PreviewNetworkCondition(
        failureDelay: .zero,
        failure: nil,
        failureLimit: 0
    )

    static let unavailable = PreviewNetworkCondition(
        failureDelay: .zero,
        failure: tournamentUnavailableError,
        failureLimit: nil
    )

    static let delayedRecovery = PreviewNetworkCondition(
        failureDelay: .seconds(3),
        failure: tournamentUnavailableError,
        failureLimit: 1
    )

    private static let tournamentUnavailableError =
        AppError.networkUnavailable(
            "The tournament service is temporarily unavailable."
        )
}
