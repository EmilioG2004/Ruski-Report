//
//  GuestSessionRepository.swift
//  Ruski Report
//

import Foundation

final class GuestSessionRepository: SessionRepository {
    func currentSession() async -> UserSession {
        .guest
    }
}
