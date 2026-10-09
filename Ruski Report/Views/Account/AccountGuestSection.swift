//
//  AccountGuestSection.swift
//  Ruski Report
//
//  Presents guest authentication controls bound to the account form model.
//

import SwiftUI

struct AccountGuestSection: View {
    @ObservedObject var session: AccountSessionStore
    @ObservedObject var form: AccountSessionFormModel
    let submit: () async -> Void

    var body: some View {
        Section {
            Picker(AccountCopy.accountAction, selection: $form.mode) {
                ForEach(AccountFormMode.allCases) { mode in
                    Text(mode.label).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("account.mode")

            TextField(AccountCopy.displayName, text: $form.displayName)
                .textContentType(.username)
                .autocorrectionDisabled()
                .accessibilityIdentifier("account.displayName")

            SecureField(AccountCopy.password, text: $form.password)
                .textContentType(form.mode == .signIn ? .password : .newPassword)
                .submitLabel(.go)
                .onSubmit { Task { await submit() } }
                .accessibilityIdentifier("account.password")

            if let message = form.errorMessage {
                AccountErrorText(message: message)
            }

            Button {
                Task { await submit() }
            } label: {
                if session.activity == .authenticating {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Label(form.mode.buttonLabel, systemImage: form.mode.systemImage)
                        .frame(maxWidth: .infinity)
                }
            }
            .disabled(!form.canSubmit)
            .accessibilityIdentifier("account.submit")
        } header: {
            Text(form.mode.sectionTitle)
        }
    }
}
