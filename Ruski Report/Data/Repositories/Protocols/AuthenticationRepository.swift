//
//  AuthenticationRepository.swift
//  Ruski Report
//

import Foundation

nonisolated protocol AuthenticationRepository {
    func register(
        displayName: String,
        password: String
    ) async throws -> AuthenticatedAccountSession

    func login(
        displayName: String,
        password: String
    ) async throws -> AuthenticatedAccountSession

    func currentProfile() async throws -> UserProfile
    func signOut() async throws
    func deleteAccount() async throws
}
