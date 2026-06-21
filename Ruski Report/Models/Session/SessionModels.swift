//
//  SessionModels.swift
//  Ruski Report
//

import Foundation

nonisolated enum UserSession: Equatable {
    case guest
    case authenticated(UserProfile)
}

nonisolated struct UserProfile: Identifiable, Equatable {
    let id: String
    let displayName: String
}
