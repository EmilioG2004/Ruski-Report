//
//  RequestAuthorizer.swift
//  Ruski Report
//

import Foundation

nonisolated protocol RequestAuthorizer {
    func authorize(_ request: inout URLRequest) async throws
}

nonisolated struct NoopRequestAuthorizer: RequestAuthorizer {
    func authorize(_ request: inout URLRequest) async throws {}
}

nonisolated final class BearerTokenRequestAuthorizer: RequestAuthorizer {
    private let credentials: any SessionCredentialStore

    init(credentials: any SessionCredentialStore) {
        self.credentials = credentials
    }

    func authorize(_ request: inout URLRequest) async throws {
        guard let token = try await credentials.accessToken() else {
            return
        }

        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
}
