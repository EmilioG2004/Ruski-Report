//
//  AccountSessionView.swift
//  Ruski Report
//
//  Composes account form sections and navigation while delegating validation
//  and asynchronous session actions to AccountSessionFormModel.
//

import SwiftUI

struct AccountSessionView: View {
    @ObservedObject var session: AccountSessionStore
    @ObservedObject var userBlocking: UserBlockingStore
    let policyLinks: AppPolicyLinks

    @Environment(\.dismiss) private var dismiss
    @StateObject private var form: AccountSessionFormModel

    init(
        session: AccountSessionStore,
        userBlocking: UserBlockingStore,
        policyLinks: AppPolicyLinks
    ) {
        self.session = session
        self.userBlocking = userBlocking
        self.policyLinks = policyLinks
        _form = StateObject(
            wrappedValue: AccountSessionFormModel(session: session)
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                statusSection

                switch session.current {
                case .guest:
                    AccountGuestSection(session: session, form: form) {
                        if await form.submit() {
                            dismiss()
                        }
                    }
                case .authenticated:
                    authenticatedSections(allowsDeletion: true)
                case .admin:
                    authenticatedSections(allowsDeletion: false)
                }

                AccountPolicyLinksSection(links: policyLinks)
            }
            .scrollContentBackground(.hidden)
            .background(Color.appGroupedBackground)
            .navigationTitle(AccountCopy.navigationTitle)
            .tint(Color.appBrand)
            .environment(\.defaultMinListRowHeight, AppLayout.minimumTapTarget)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(AccountCopy.done) { dismiss() }
                        .disabled(session.activity == .deletingAccount)
                }
            }
            .alert(
                AccountCopy.deleteConfirmationTitle,
                isPresented: $form.isDeleteConfirmationPresented
            ) {
                Button(AccountCopy.cancel, role: .cancel) {}
                    .accessibilityIdentifier("account.delete.cancel")

                Button(AccountCopy.deleteAccount, role: .destructive) {
                    Task { await form.deleteAccount() }
                }
                .accessibilityIdentifier("account.delete.confirm")
            } message: {
                Text(AccountCopy.deleteConfirmationMessage)
            }
        }
    }

    private var statusSection: some View {
        Section(AccountCopy.statusSection) {
            AccountStatusRow(session: session.current)

            if let notice = form.noticeMessage {
                AccountNoticeText(message: notice)
            }
        }
    }

    @ViewBuilder
    private func authenticatedSections(allowsDeletion: Bool) -> some View {
        AccountSignedInSection(session: session, form: form)
        AccountSafetySection(session: session, userBlocking: userBlocking)

        if allowsDeletion {
            AccountDeletionSection(session: session, form: form)
        }
    }
}
