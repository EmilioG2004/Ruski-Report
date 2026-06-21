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
    private let logger = Logger(
        subsystem: "Durham-Ruski-Club.Ruski-Report",
        category: "App"
    )

    func log(
        _ level: AppLogLevel,
        _ message: String,
        metadata: [String: String] = [:]
    ) {
        let metadataDescription = metadata
            .map { "\($0.key)=\($0.value)" }
            .sorted()
            .joined(separator: " ")

        switch level {
        case .debug:
            logger.debug("\(message, privacy: .public) \(metadataDescription, privacy: .public)")
        case .info:
            logger.info("\(message, privacy: .public) \(metadataDescription, privacy: .public)")
        case .warning:
            logger.warning("\(message, privacy: .public) \(metadataDescription, privacy: .public)")
        case .error:
            logger.error("\(message, privacy: .public) \(metadataDescription, privacy: .public)")
        }
    }
}

nonisolated final class NoopAppLogger: AppLogger {
    func log(
        _ level: AppLogLevel,
        _ message: String,
        metadata: [String: String] = [:]
    ) {}
}
