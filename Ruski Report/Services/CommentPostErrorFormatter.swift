//
//  CommentPostErrorFormatter.swift
//  Ruski Report
//

import Foundation

nonisolated enum CommentPostErrorFormatter {
    static func message(from error: Error) -> String {
        guard case .backend(_, _, let details) = error as? AppError,
              let detailCode = details.compactMap(\.code).first else {
            return AppErrorMessageFormatter.message(
                from: error,
                fallback: "Unable to post comment."
            )
        }

        return switch detailCode {
        case "COMMENT_CONTENT_NOT_ALLOWED":
            "That comment doesn’t meet the community standards. Edit it and try again."
        case "COMMENT_SPAM_DETECTED":
            "That comment looks like spam. Edit it and try again."
        case "COMMENT_RECENTLY_REPEATED":
            "You recently posted that comment. Wait a moment before trying again."
        default:
            AppErrorMessageFormatter.message(
                from: error,
                fallback: "Unable to post comment."
            )
        }
    }
}
