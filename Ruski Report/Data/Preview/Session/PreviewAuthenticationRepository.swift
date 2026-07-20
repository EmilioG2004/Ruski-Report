//
//  PreviewAuthenticationRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class PreviewAuthenticationRepository: AuthenticationRepository {
    private let profile = UserProfile(
        id: "preview-user",
        displayName: "Preview User",
        provider: .localAccount
    )

    func register(
        displayName: String,
        password: String
    ) async throws -> AuthenticatedAccountSession {
        makeSession(displayName: displayName)
    }

    func login(
        displayName: String,
        password: String
    ) async throws -> AuthenticatedAccountSession {
        makeSession(displayName: displayName)
    }

    func currentProfile() async throws -> UserProfile {
        profile
    }

    func signOut() async throws {}

    private func makeSession(displayName: String) -> AuthenticatedAccountSession {
        AuthenticatedAccountSession(
            profile: UserProfile(
                id: profile.id,
                displayName: displayName.trimmingCharacters(in: .whitespacesAndNewlines),
                provider: profile.provider
            ),
            token: "preview-session-token",
            expiresAt: "2099-01-01T00:00:00.000Z"
        )
    }
}
