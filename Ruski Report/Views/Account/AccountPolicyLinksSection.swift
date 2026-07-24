//
//  AccountPolicyLinksSection.swift
//  Ruski Report
//

import SwiftUI

struct AccountPolicyLinksSection: View {
    let links: AppPolicyLinks

    var body: some View {
        Section("Help & Policies") {
            PolicyLinkRow(
                title: "Privacy Policy",
                systemImage: "hand.raised",
                destination: links.privacyPolicy,
                accessibilityIdentifier: "account.policy.privacy"
            )
            PolicyLinkRow(
                title: "Support",
                systemImage: "questionmark.circle",
                destination: links.support,
                accessibilityIdentifier: "account.policy.support"
            )
            PolicyLinkRow(
                title: "Community Standards",
                systemImage: "person.2",
                destination: links.communityStandards,
                accessibilityIdentifier: "account.policy.community"
            )
        }
    }
}

private struct PolicyLinkRow: View {
    let title: String
    let systemImage: String
    let destination: URL
    let accessibilityIdentifier: String

    var body: some View {
        Link(destination: destination) {
            HStack {
                Label(title, systemImage: systemImage)
                Spacer()
                Image(systemName: "arrow.up.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .accessibilityIdentifier(accessibilityIdentifier)
    }
}
