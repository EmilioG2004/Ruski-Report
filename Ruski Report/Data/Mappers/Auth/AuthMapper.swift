//
//  AuthMapper.swift
//  Ruski Report
//

import Foundation

nonisolated enum AuthMapper {
    static func profile(_ dto: AuthenticatedUserDTO) -> UserProfile {
        UserProfile(
            id: dto.id,
            displayName: dto.displayName,
            provider: provider(dto.provider)
        )
    }

    static func session(_ dto: CreatedSessionDTO) -> AuthenticatedAccountSession {
        AuthenticatedAccountSession(
            profile: profile(dto.user),
            token: dto.token,
            expiresAt: dto.expiresAt
        )
    }

    private static func provider(_ value: String) -> SessionIdentityProvider {
        switch value {
        case "local_account":
            .localAccount
        case "game_center":
            .gameCenter
        case "tau_id":
            .tauId
        default:
            .unknown(value)
        }
    }
}
