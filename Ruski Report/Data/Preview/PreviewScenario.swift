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
    case recovering
    case authenticated
    case moderationRejected
    case reporting
    case reportUnavailable
    case blocking
    case longContent
    case publicZero = "public-zero"
    case publicTwo = "public-two"
    case publicStates = "public-states"
    case publicLongContent = "public-long-content"

    static func resolve(from arguments: [String]) -> PreviewScenario {
        guard let flagIndex = arguments.firstIndex(of: argumentName),
              arguments.indices.contains(flagIndex + 1) else {
            return .standard
        }

        return PreviewScenario(rawValue: arguments[flagIndex + 1]) ?? .standard
    }
}
