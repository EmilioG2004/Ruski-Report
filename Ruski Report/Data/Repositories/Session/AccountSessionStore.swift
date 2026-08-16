//
//  AccountSessionStore.swift
//  Ruski Report
//

import Combine
import Foundation

@MainActor
final class AccountSessionStore: ObservableObject, SessionRepository {
    @Published private(set) var current: UserSession
    @Published private(set) var activity: AccountSessionActivity = .idle

    private let authentication: any AuthenticationRepository
    private let credentials: any SessionCredentialStore
    private let logger: any AppLogger
    private var hasAttemptedRestore = false

    init(
        initialSession: UserSession = .guest,
        authentication: any AuthenticationRepository,
        credentials: any SessionCredentialStore,
        logger: any AppLogger = NoopAppLogger()
    ) {
        current = initialSession
        self.authentication = authentication
        self.credentials = credentials
        self.logger = logger
    }

    func currentSession() async -> UserSession {
        current
    }

    func restoreSession() async {
        guard !hasAttemptedRestore else {
            return
        }
        hasAttemptedRestore = true
        activity = .restoring
        defer { activity = .idle }

        do {
            guard try await credentials.accessToken() != nil else {
                current = .guest
                return
            }

            let profile = try await authentication.currentProfile()
            current = .authenticated(profile)
            logger.log(
                .info,
                "Account session restored",
                metadata: ["provider": profile.provider.logValue]
            )
        } catch {
            if isUnauthorized(error) {
                try? await credentials.clearAccessToken()
            }
            current = .guest
            logger.log(
                .warning,
                "Unable to restore account session",
                metadata: ["error": String(describing: error)]
            )
        }
    }

    func register(displayName: String, password: String) async throws {
        try await authenticate {
            try await authentication.register(
                displayName: displayName,
                password: password
            )
        }
    }

    func signIn(displayName: String, password: String) async throws {
        try await authenticate {
            try await authentication.login(
                displayName: displayName,
                password: password
            )
        }
    }

    func signOut() async throws {
        do {
            try await authentication.signOut()
        } catch {
            logger.log(
                .warning,
                "Unable to revoke remote account session",
                metadata: ["error": String(describing: error)]
            )
        }

        try await credentials.clearAccessToken()
        current = .guest
        logger.log(.info, "Account session signed out", metadata: [:])
    }

    func deleteAccount() async throws {
        activity = .deletingAccount
        defer { activity = .idle }

        do {
            try await authentication.deleteAccount()
        } catch {
            try await handleDeletionFailure(error)
            return
        }

        current = .guest

        do {
            try await credentials.clearAccessToken()
        } catch {
            logger.log(
                .error,
                "Account deleted but local credentials could not be cleared",
                metadata: ["error": String(describing: error)]
            )
            throw AccountDeletionError.localCredentialCleanupFailed
        }

        logger.log(.info, "Account deleted", metadata: [:])
    }

    private func authenticate(
        operation: () async throws -> AuthenticatedAccountSession
    ) async throws {
        activity = .authenticating
        defer { activity = .idle }

        let session = try await operation()
        try await credentials.saveAccessToken(session.token)
        current = .authenticated(session.profile)
        logger.log(
            .info,
            "Account session authenticated",
            metadata: ["provider": session.profile.provider.logValue]
        )
    }

    private func handleDeletionFailure(_ deletionError: Error) async throws {
        if isUnauthorized(deletionError) {
            try await clearInvalidLocalSession()
            throw AccountDeletionError.reauthenticationRequired
        }

        do {
            _ = try await authentication.currentProfile()
        } catch {
            try await clearInvalidLocalSession()
            throw AccountDeletionError.deletionStatusUnknown
        }

        throw deletionError
    }

    private func clearInvalidLocalSession() async throws {
        current = .guest

        do {
            try await credentials.clearAccessToken()
        } catch {
            logger.log(
                .error,
                "Unable to clear invalid local account credentials",
                metadata: ["error": String(describing: error)]
            )
            throw AccountDeletionError.localCredentialCleanupFailed
        }
    }

    private func isUnauthorized(_ error: Error) -> Bool {
        switch error as? AppError {
        case .backend(let code, _, _):
            code == "UNAUTHORIZED"
        case .badStatus(let code, _):
            code == 401
        default:
            false
        }
    }
}

private extension SessionIdentityProvider {
    var logValue: String {
        switch self {
        case .localAccount: "local_account"
        case .gameCenter: "game_center"
        case .tauId: "tau_id"
        case .adminToken: "admin_token"
        case .unknown(let value): value
        }
    }
}
