//
//  RemoteAuthenticationRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class RemoteAuthenticationRepository: AuthenticationRepository {
    private let apiClient: any APIClient

    init(apiClient: any APIClient) {
        self.apiClient = apiClient
    }

    func register(
        displayName: String,
        password: String
    ) async throws -> AuthenticatedAccountSession {
        let dto: CreatedSessionDTO = try await apiClient.post(
            "auth/register",
            body: AuthCredentialsDTO(displayName: displayName, password: password)
        )
        return AuthMapper.session(dto)
    }

    func login(
        displayName: String,
        password: String
    ) async throws -> AuthenticatedAccountSession {
        let dto: CreatedSessionDTO = try await apiClient.post(
            "auth/login",
            body: AuthCredentialsDTO(displayName: displayName, password: password)
        )
        return AuthMapper.session(dto)
    }

    func currentProfile() async throws -> UserProfile {
        let dto: CurrentSessionDTO = try await apiClient.get("auth/session")
        return AuthMapper.profile(dto.user)
    }

    func signOut() async throws {
        try await apiClient.delete("auth/session")
    }
}
