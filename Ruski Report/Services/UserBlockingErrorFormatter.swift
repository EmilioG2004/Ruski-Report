//
//  UserBlockingErrorFormatter.swift
//  Ruski Report
//

import Foundation

nonisolated enum UserBlockingErrorFormatter {
    static func message(from error: Error) -> String {
        guard case .backend(let code, _, let details) = error as? AppError else {
            return AppErrorMessageFormatter.message(
                from: error,
                fallback: "Unable to update blocked users."
            )
        }

        if code == "UNAUTHORIZED" {
            return "Sign in again to manage blocked users."
        }

        return switch details.compactMap(\.code).first {
        case "SELF_BLOCK_NOT_ALLOWED":
            "You cannot block your own account."
        case "BLOCKED_ACCOUNT_NOT_FOUND":
            "That account is no longer available."
        default:
            "Unable to update blocked users."
        }
    }

    static func isAccountUnavailable(_ error: Error) -> Bool {
        guard case .backend(_, _, let details) = error as? AppError else {
            return false
        }
        return details.contains { $0.code == "BLOCKED_ACCOUNT_NOT_FOUND" }
    }
}
