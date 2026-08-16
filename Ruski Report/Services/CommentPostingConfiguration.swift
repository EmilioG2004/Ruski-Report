//
//  CommentPostingConfiguration.swift
//  Ruski Report
//

import Foundation

nonisolated struct CommentPostingConfiguration: Equatable {
    let maximumBodyLength: Int
    let emptyBodyMessage: String

    static let `default` = CommentPostingConfiguration(
        maximumBodyLength: 500,
        emptyBodyMessage: "Enter a comment before posting."
    )

    func validatedBody(_ body: String) -> Result<String, CommentPostingValidationError> {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)

        if trimmed.isEmpty {
            return .failure(.invalid(message: emptyBodyMessage))
        }

        if trimmed.count > maximumBodyLength {
            return .failure(
                .invalid(
                    message: "Comments must be \(maximumBodyLength) characters or fewer."
                )
            )
        }

        return .success(trimmed)
    }
}

nonisolated enum CommentPostingValidationError: Error, Equatable {
    case invalid(message: String)
}
