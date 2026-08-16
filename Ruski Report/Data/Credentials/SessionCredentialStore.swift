//
//  SessionCredentialStore.swift
//  Ruski Report
//

import Foundation

nonisolated protocol SessionCredentialStore: Sendable {
    func accessToken() async throws -> String?
    func saveAccessToken(_ token: String) async throws
    func clearAccessToken() async throws
}

actor InMemorySessionCredentialStore: SessionCredentialStore {
    private var token: String?

    init(token: String? = nil) {
        self.token = token
    }

    func accessToken() -> String? {
        token
    }

    func saveAccessToken(_ token: String) {
        self.token = token
    }

    func clearAccessToken() {
        token = nil
    }
}
