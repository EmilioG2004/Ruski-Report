//
//  AccountSessionView.swift
//  Ruski Report
//

import SwiftUI

struct AccountSessionView: View {
    @ObservedObject var session: LocalSessionRepository
    @Environment(\.dismiss) private var dismiss
    @State private var displayName = ""
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
            .onAppear(perform: syncDraftWithSession)
            .onChange(of: session.current) { _, _ in
                syncDraftWithSession()
            }
        }
    }

    private var guestControls: some View {
        Section("Sign In") {
            TextField("Display name", text: $displayName)
                .submitLabel(.done)
                .onSubmit(signIn)
                .accessibilityIdentifier("account.displayName")

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("account.error")
            }

            Button(action: signIn) {
                Label("Sign In", systemImage: "person.crop.circle.badge.plus")
            }
            .disabled(trimmedDisplayName.isEmpty)
            .accessibilityIdentifier("account.signIn")
        }
    }

    private var signedInControls: some View {
        Section("Session") {
            Button(role: .destructive) {
                session.signOut()
                errorMessage = nil
                displayName = ""
            } label: {
                Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
            }
            .accessibilityIdentifier("account.signOut")
        }
    }

    private var trimmedDisplayName: String {
        displayName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func signIn() {
        let result = session.signIn(displayName: displayName)

        switch result {
        case .success:
            errorMessage = nil
            dismiss()
        case .failure(let error):
            errorMessage = error.message
        }
    }

    private func syncDraftWithSession() {
        switch session.current {
        case .guest:
            break
        case .authenticated(let profile), .admin(let profile):
            displayName = profile.displayName
        }
    }
}

private struct AccountStatusRow: View {
    let session: UserSession

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: iconName)
                .font(.title3)
                .foregroundStyle(Color.accentColor)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 3) {
                Text(session.displayName)
                    .font(.body.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)

                Text(statusText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 12)
        }
        .accessibilityIdentifier("account.status")
    }

    private var iconName: String {
        switch session {
        case .guest:
            "person.crop.circle"
        case .authenticated:
            "person.crop.circle.fill"
        case .admin:
            "person.crop.circle.badge.checkmark"
        }
    }

    private var statusText: String {
        switch session {
        case .guest:
            "Guest"
        case .authenticated(let profile), .admin(let profile):
            profile.provider.displayName
        }
    }
}

private extension SessionIdentityProvider {
    var displayName: String {
        switch self {
        case .localAccount:
            "Local Account"
        case .gameCenter:
            "Game Center"
        case .tauId:
            "TAU ID"
        case .adminToken:
            "Admin"
        case .unknown(let value):
            value
        }
    }
}
