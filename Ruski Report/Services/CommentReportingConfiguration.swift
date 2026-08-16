//
//  CommentReportingConfiguration.swift
//  Ruski Report
//

import Foundation

nonisolated struct CommentReportingConfiguration: Equatable {
    let maximumContextLength: Int

    static let `default` = CommentReportingConfiguration(
        maximumContextLength: 500
    )

    func validatedContext(
        _ context: String,
        reason: CommentReportReason
    ) -> Result<String?, CommentReportingValidationError> {
        let trimmed = context.trimmingCharacters(in: .whitespacesAndNewlines)

        if reason == .other && trimmed.isEmpty {
            return .failure(
                .invalid(message: "Add context when selecting Other.")
            )
        }
        if trimmed.count > maximumContextLength {
            return .failure(
                .invalid(
                    message:
                        "Report context must be \(maximumContextLength) characters or fewer."
                )
            )
        }
        return .success(trimmed.isEmpty ? nil : trimmed)
    }
}

nonisolated enum CommentReportingValidationError: Error, Equatable {
    case invalid(message: String)
}
