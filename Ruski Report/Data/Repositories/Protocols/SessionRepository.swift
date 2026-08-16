//
//  SessionRepository.swift
//  Ruski Report
//

import Foundation

@MainActor
protocol SessionRepository {
    func currentSession() async -> UserSession
}
