//
//  AuthDTO.swift
//  Ruski Report
//

import Foundation

nonisolated struct AuthCredentialsDTO: Encodable, Equatable {
    let displayName: String
    let password: String
}

nonisolated struct AuthenticatedUserDTO: Decodable, Equatable {
    let id: String
    let displayName: String
    let provider: String
}

nonisolated struct CurrentSessionDTO: Decodable, Equatable {
    let user: AuthenticatedUserDTO
    let expiresAt: String
}

nonisolated struct CreatedSessionDTO: Decodable, Equatable {
    let user: AuthenticatedUserDTO
    let expiresAt: String
    let token: String
}
