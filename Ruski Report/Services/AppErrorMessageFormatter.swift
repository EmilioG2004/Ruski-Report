//
//  AppErrorMessageFormatter.swift
//  Ruski Report
//

import Foundation

nonisolated enum AppErrorMessageFormatter {
    static func message(from error: Error, fallback: String) -> String {
        if let errorDescription = (error as? LocalizedError)?.errorDescription,
           !errorDescription.isEmpty {
            return errorDescription
        }

        return fallback
    }
}
