//
//  AccountStatusRow.swift
//  Ruski Report
//
//  Summarizes the active account identity and role with the shared monogram and
//  semantic visual tokens.
//

import SwiftUI

struct AccountStatusRow: View {
    let session: UserSession

    var body: some View {
        HStack(spacing: AppLayout.standardSpacing) {
            TeamMonogramView(
                name: session.displayName,
                size: AppLayout.heroTeamMonogramSize
            )

            VStack(alignment: .leading, spacing: AppLayout.microSpacing) {
                Text(session.displayName)
                    .font(.body.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)

                Text(statusText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: AppLayout.standardSpacing)

            Text(roleText)
                .font(.caption2.weight(.bold))
                .foregroundStyle(iconColor)
                .padding(.horizontal, AppLayout.smallSpacing)
                .padding(.vertical, AppLayout.pillVerticalPadding)
                .background(
                    iconColor.opacity(AppVisualTokens.subtleTintOpacity)
                )
                .clipShape(Capsule())
        }
        .accessibilityIdentifier("account.status.\(session.kind.rawValue)")
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
        session.kind == .guest ? .secondary : .appBrand
    }

    private var roleText: String {
        switch session {
        case .guest: "GUEST"
        case .authenticated: "MEMBER"
        case .admin: "ADMIN"
        }
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
