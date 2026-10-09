//
//  AccountSignedInSections.swift
//  Ruski Report
//
//  Provides focused session, safety, and destructive account sections for
//  authenticated presentations.
//

import SwiftUI

struct AccountSignedInSection: View {
    @ObservedObject var session: AccountSessionStore
    @ObservedObject var form: AccountSessionFormModel

    var body: some View {
        Section(AccountCopy.sessionSection) {
            Button(role: .destructive) {
                Task { await form.signOut() }
            } label: {
                Label(
                    AccountCopy.signOut,
                    systemImage: "rectangle.portrait.and.arrow.right"
                )
            }
            .disabled(session.activity != .idle)
            .accessibilityIdentifier("account.signOut")

            if let message = form.errorMessage {
                AccountErrorText(message: message)
            }
        }
    }
}

struct AccountSafetySection: View {
    @ObservedObject var session: AccountSessionStore
    @ObservedObject var userBlocking: UserBlockingStore

    var body: some View {
        Section(AccountCopy.safetySection) {
            NavigationLink {
                BlockedUsersView(blocking: userBlocking)
            } label: {
                Label(
                    AccountCopy.blockedUsers,
                    systemImage: "person.crop.circle.badge.xmark"
                )
            }
            .disabled(session.activity != .idle)
            .accessibilityIdentifier("account.blocks")
        }
    }
}

struct AccountDeletionSection: View {
    @ObservedObject var session: AccountSessionStore
    @ObservedObject var form: AccountSessionFormModel

    var body: some View {
        Section {
            Button(role: .destructive, action: form.requestDeletion) {
                if session.activity == .deletingAccount {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .accessibilityIdentifier("account.delete.progress")
                } else {
                    Label(
                        AccountCopy.deleteAccount,
                        systemImage: "person.crop.circle.badge.minus"
                    )
                }
            }
            .disabled(session.activity != .idle)
            .accessibilityIdentifier("account.delete")
        } header: {
            Text(AccountCopy.dangerSection)
        } footer: {
            Text(AccountCopy.deletionFooter)
        }
    }
}
