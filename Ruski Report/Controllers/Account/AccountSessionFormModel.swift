//
//  AccountSessionFormModel.swift
//  Ruski Report
//
//  Encapsulates account-form state, validation, and asynchronous workflows so
//  SwiftUI sections contain presentation logic only.
//

import Combine
import Foundation

@MainActor
final class AccountSessionFormModel: ObservableObject {
    @Published var mode = AccountFormMode.signIn {
        didSet { errorMessage = nil }
    }
    @Published var displayName = ""
    @Published var password = ""
    @Published private(set) var errorMessage: String?
    @Published private(set) var noticeMessage: String?
    @Published var isDeleteConfirmationPresented = false

    private let session: AccountSessionStore

    init(session: AccountSessionStore) {
        self.session = session
    }

    var canSubmit: Bool {
        session.activity == .idle &&
            !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !password.isEmpty
    }

    func submit() async -> Bool {
        guard canSubmit else { return false }

        do {
            switch mode {
            case .signIn:
                try await session.signIn(displayName: displayName, password: password)
            case .createAccount:
                try await session.register(displayName: displayName, password: password)
            }
            clearMessagesAndSensitiveFields()
            return true
        } catch {
            errorMessage = AppErrorMessageFormatter.message(
                from: error,
                fallback: AccountCopy.authenticationFailure
            )
            return false
        }
    }

    func signOut() async {
        do {
            try await session.signOut()
            clearAllFields()
        } catch {
            errorMessage = AppErrorMessageFormatter.message(
                from: error,
                fallback: AccountCopy.signOutFailure
            )
        }
    }

    func requestDeletion() {
        errorMessage = nil
        noticeMessage = nil
        isDeleteConfirmationPresented = true
    }

    func deleteAccount() async {
        do {
            try await session.deleteAccount()
            clearAllFields()
            noticeMessage = AccountCopy.deletionSuccess
        } catch {
            noticeMessage = nil
            errorMessage = AppErrorMessageFormatter.message(
                from: error,
                fallback: AccountCopy.deletionFailure
            )
        }
    }

    private func clearMessagesAndSensitiveFields() {
        errorMessage = nil
        noticeMessage = nil
        password = ""
    }

    private func clearAllFields() {
        clearMessagesAndSensitiveFields()
        displayName = ""
    }
}
