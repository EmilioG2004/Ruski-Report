//
//  GuestSessionRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class GuestSessionRepository: SessionRepository {
    func currentSession() async -> UserSession {
        .guest
    }
}
