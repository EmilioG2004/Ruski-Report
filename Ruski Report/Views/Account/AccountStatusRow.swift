//
//  AccountStatusRow.swift
//  Ruski Report
//

import SwiftUI

struct AccountStatusRow: View {
    let session: UserSession

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: iconName)
                .font(.title3)
                .foregroundStyle(iconColor)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 3) {
                Text(session.displayName)
                    .font(.body.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)

                Text(statusText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 12)
        }
        .accessibilityIdentifier("account.status.\(session.kind.rawValue)")
    }

    private var iconName: String {
        switch session {
        case .guest: "person.crop.circle"
        case .authenticated: "person.crop.circle.fill"
        case .admin: "person.crop.circle.badge.checkmark"
        }
    }

    private var statusText: String {
        switch session {
        case .guest:
            "Browsing as a guest"
        case .authenticated(let profile), .admin(let profile):
            "Signed in with \(profile.provider.displayName)"
        }
    }

    private var iconColor: Color {
        session.kind == .guest ? .secondary : .appFinal
    }
}

private extension SessionIdentityProvider {
    var displayName: String {
        switch self {
        case .localAccount: "Local Account"
        case .gameCenter: "Game Center"
        case .tauId: "TAU ID"
        case .adminToken: "Admin"
        case .unknown(let value): value
        }
    }
}
