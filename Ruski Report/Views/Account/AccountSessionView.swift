//
//  AccountSessionView.swift
//  Ruski Report
//

import SwiftUI

struct AccountSessionView: View {
    @ObservedObject var session: AccountSessionStore
    @Environment(\.dismiss) private var dismiss
    @State private var mode = AccountFormMode.signIn
    @State private var displayName = ""
    @State private var password = ""
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Status") {
                    AccountStatusRow(session: session.current)
                }

                switch session.current {
                case .guest:
                    guestControls
                case .authenticated, .admin:
                    signedInControls
                }
            }
            .navigationTitle("Account")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .onChange(of: mode) { _, _ in
                errorMessage = nil
            }
        }
    }

    private var guestControls: some View {
        Section {
            Picker("Account action", selection: $mode) {
                ForEach(AccountFormMode.allCases) { mode in
                    Text(mode.label).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("account.mode")

            TextField("Display name", text: $displayName)
                .textContentType(.username)
                .autocorrectionDisabled()
                .accessibilityIdentifier("account.displayName")

            SecureField("Password", text: $password)
                .textContentType(mode == .signIn ? .password : .newPassword)
                .submitLabel(.go)
                .onSubmit(submit)
                .accessibilityIdentifier("account.password")

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("account.error")
            }

            Button(action: submit) {
                if session.activity == .authenticating {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Label(mode.buttonLabel, systemImage: mode.systemImage)
                        .frame(maxWidth: .infinity)
                }
            }
            .disabled(!canSubmit)
            .accessibilityIdentifier("account.submit")
        } header: {
            Text(mode.sectionTitle)
        }
    }

    private var signedInControls: some View {
        Section("Session") {
            Button(role: .destructive) {
                Task {
                    do {
                        try await session.signOut()
                        errorMessage = nil
                        displayName = ""
                        password = ""
                    } catch {
                        errorMessage = AppErrorMessageFormatter.message(
                            from: error,
                            fallback: "Unable to sign out."
                        )
                    }
                }
            } label: {
                Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
            }
            .disabled(session.activity != .idle)
            .accessibilityIdentifier("account.signOut")

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("account.error")
            }
        }
    }

    private var canSubmit: Bool {
        session.activity == .idle &&
            !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !password.isEmpty
    }

    private func submit() {
        guard canSubmit else {
            return
        }

        Task {
            do {
                switch mode {
                case .signIn:
                    try await session.signIn(
                        displayName: displayName,
                        password: password
                    )
                case .createAccount:
                    try await session.register(
                        displayName: displayName,
                        password: password
                    )
                }
                errorMessage = nil
                password = ""
                dismiss()
            } catch {
                errorMessage = AppErrorMessageFormatter.message(
                    from: error,
                    fallback: "Unable to authenticate."
                )
            }
        }
    }
}

private enum AccountFormMode: String, CaseIterable, Identifiable {
    case signIn
    case createAccount

    var id: String { rawValue }

    var label: String {
        switch self {
        case .signIn: "Sign In"
        case .createAccount: "Create"
        }
    }

    var sectionTitle: String {
        switch self {
        case .signIn: "Sign In"
        case .createAccount: "Create Account"
        }
    }

    var buttonLabel: String {
        sectionTitle
    }

    var systemImage: String {
        switch self {
        case .signIn: "person.crop.circle.badge.checkmark"
        case .createAccount: "person.crop.circle.badge.plus"
        }
    }
}
