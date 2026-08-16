//
//  AccountDeletionError.swift
//  Ruski Report
//

import Foundation

nonisolated enum AccountDeletionError: Error, Equatable {
    case reauthenticationRequired
    case deletionStatusUnknown
    case localCredentialCleanupFailed
}

nonisolated extension AccountDeletionError: LocalizedError {
    var errorDescription: String? {
        switch self {
        case .reauthenticationRequired:
            "Your session expired before the account could be deleted. Sign in again to retry."
        case .deletionStatusUnknown:
            "The server did not confirm whether the account was deleted. Try signing in again; if the account still exists, retry deletion."
        case .localCredentialCleanupFailed:
            "This device could not clear its saved sign-in token. Please try again."
        }
    }
}
