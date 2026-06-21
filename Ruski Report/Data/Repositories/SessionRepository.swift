//
//  SessionRepository.swift
//  Ruski Report
//

import Foundation

nonisolated protocol SessionRepository {
    func currentSession() async -> UserSession
}
