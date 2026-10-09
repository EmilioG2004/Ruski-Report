//
//  AppLogger.swift
//  Ruski Report
//

import Foundation
import OSLog

nonisolated enum AppLogLevel: String {
    case debug
    case info
    case warning
    case error
}

nonisolated protocol AppLogger {
    func log(
        _ level: AppLogLevel,
        _ message: String,
        metadata: [String: String]
    )
}

nonisolated final class OSLogAppLogger: AppLogger {
    private let logger: Logger

    init(
        subsystem: String = AppBundleIdentity.logSubsystem,
        category: String = "App"
    ) {
        logger = Logger(subsystem: subsystem, category: category)
    }

    func log(
        _ level: AppLogLevel,
        _ message: String,
        metadata: [String: String] = [:]
    ) {
        let payload = sanitizedAppLogPayload(message: message, metadata: metadata)

        switch level {
        case .debug:
            logger.debug("\(payload.message, privacy: .public) \(payload.metadataDescription, privacy: .public)")
        case .info:
            logger.info("\(payload.message, privacy: .public) \(payload.metadataDescription, privacy: .public)")
        case .warning:
            logger.warning("\(payload.message, privacy: .public) \(payload.metadataDescription, privacy: .public)")
        case .error:
            logger.error("\(payload.message, privacy: .public) \(payload.metadataDescription, privacy: .public)")
        }
    }
}

nonisolated struct SanitizedAppLogPayload: Equatable {
    let message: String
    let metadataDescription: String
}

nonisolated func sanitizedAppLogPayload(
    message: String,
    metadata: [String: String]
) -> SanitizedAppLogPayload {
    let safeMessage = safeAppLogMessages.contains(message)
        ? message
        : "Application event"
    let publicKeys = Set(["operation", "projectionVersion", "provider", "scope"])
    let metadataDescription = metadata
        .filter { key, value in
            publicKeys.contains(key) &&
                value.range(
                    of: #"^[A-Za-z0-9_.:-]{1,80}$"#,
                    options: .regularExpression
                ) != nil
        }
        .map { "\($0.key)=\($0.value)" }
        .sorted()
        .joined(separator: " ")
    return SanitizedAppLogPayload(
        message: safeMessage,
        metadataDescription: metadataDescription
    )
}

private nonisolated let safeAppLogMessages = Set([
    "Account deleted",
    "Account deleted but local credentials could not be cleared",
    "Account session authenticated",
    "Account session restored",
    "Account session signed out",
    "Realtime connection failed",
    "Realtime socket connecting",
    "Realtime socket subscribed",
    "Unable to block user",
    "Unable to clear invalid local account credentials",
    "Unable to load a canonical home tournament detail",
    "Unable to load active canonical tournaments",
    "Unable to load active tournament",
    "Unable to load app config; using fallback configuration",
    "Unable to load blocked users",
    "Unable to load canonical match detail",
    "Unable to load canonical tournament detail",
    "Unable to load game definition for match detail",
    "Unable to load game definition for tournament statistics",
    "Unable to load home score feed",
    "Unable to load match comments",
    "Unable to load match detail",
    "Unable to load tournament detail",
    "Unable to load tournament history",
    "Unable to post match comment",
    "Unable to revoke remote account session",
    "Unable to submit comment report",
    "Unable to unblock user"
])

nonisolated final class NoopAppLogger: AppLogger {
    func log(
        _ level: AppLogLevel,
        _ message: String,
        metadata: [String: String] = [:]
    ) {}
}
