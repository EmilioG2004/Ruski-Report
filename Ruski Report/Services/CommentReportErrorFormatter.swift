//
//  CommentReportErrorFormatter.swift
//  Ruski Report
//

import Foundation

nonisolated enum CommentReportErrorFormatter {
    static func message(from error: Error) -> String {
        guard case .backend(_, _, let details) = error as? AppError else {
            return AppErrorMessageFormatter.message(
                from: error,
                fallback: "Unable to submit the report."
            )
        }

        return switch details.compactMap(\.code).first {
        case "COMMENT_NOT_AVAILABLE":
            "That comment is no longer available."
        case "COMMENT_REPORT_RATE_LIMITED":
            "You’ve submitted several reports recently. Wait before trying again."
        case "COMMENT_REPORT_CONTEXT_REQUIRED":
            "Add context when selecting Other."
        case "COMMENT_REPORT_CONTEXT_TOO_LONG":
            "The report context is too long. Shorten it and try again."
        case "COMMENT_REPORT_REASON_INVALID", "COMMENT_REPORT_REASON_REQUIRED":
            "Select a reason for the report."
        default:
            "Unable to submit the report."
        }
    }

    static func isCommentUnavailable(_ error: Error) -> Bool {
        guard case .backend(_, _, let details) = error as? AppError else {
            return false
        }
        return details.contains { $0.code == "COMMENT_NOT_AVAILABLE" }
    }
}
