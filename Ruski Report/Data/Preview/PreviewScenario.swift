//
//  PreviewScenario.swift
//  Ruski Report
//

import Foundation

nonisolated enum PreviewScenario: String, Equatable {
    static let argumentName = "--preview-scenario"

    case standard
    case empty
    case unavailable
    case authenticated
    case moderationRejected
    case reporting
    case reportUnavailable

    static func resolve(from arguments: [String]) -> PreviewScenario {
        guard let flagIndex = arguments.firstIndex(of: argumentName),
              arguments.indices.contains(flagIndex + 1) else {
            return .standard
        }

        return PreviewScenario(rawValue: arguments[flagIndex + 1]) ?? .standard
    }
}
