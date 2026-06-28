//
//  SessionModels.swift
//  Ruski Report
//

import Foundation

nonisolated enum UserSession: Equatable {
    case guest
    case authenticated(UserProfile)
    case admin(UserProfile)

    var kind: UserSessionKind {
        switch self {
        case .guest:
            .guest
        case .authenticated:
            .authenticated
        case .admin:
            .admin
        }
    }

    var displayName: String {
        switch self {
        case .guest:
            "Guest"
        case .authenticated(let profile), .admin(let profile):
            profile.displayName
        }
    }

    var capabilities: UserSessionCapabilities {
        switch self {
        case .guest:
            UserSessionCapabilities(
                canViewTournamentData: true,
                canPostComments: false,
                canAccessAdminUploads: false
            )
        case .authenticated:
            UserSessionCapabilities(
                canViewTournamentData: true,
                canPostComments: true,
                canAccessAdminUploads: false
            )
        case .admin:
            UserSessionCapabilities(
                canViewTournamentData: true,
                canPostComments: true,
                canAccessAdminUploads: true
            )
        }
    }

    var canViewTournamentData: Bool {
        capabilities.canViewTournamentData
    }

    var canPostComments: Bool {
        capabilities.canPostComments
    }

    var canAccessAdminUploads: Bool {
        capabilities.canAccessAdminUploads
    }
}

nonisolated struct UserProfile: Identifiable, Equatable {
    let id: String
    let displayName: String
    let provider: SessionIdentityProvider

    init(
        id: String,
        displayName: String,
        provider: SessionIdentityProvider = .localAccount
    ) {
        self.id = id
        self.displayName = displayName
        self.provider = provider
    }
}

nonisolated enum UserSessionKind: String, Equatable {
    case guest
    case authenticated
    case admin
}

nonisolated struct UserSessionCapabilities: Equatable {
    let canViewTournamentData: Bool
    let canPostComments: Bool
    let canAccessAdminUploads: Bool
}

nonisolated enum SessionIdentityProvider: Equatable {
    case localAccount
    case gameCenter
    case tauId
    case adminToken
    case unknown(String)
}
