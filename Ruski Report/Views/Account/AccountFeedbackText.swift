//
//  AccountFeedbackText.swift
//  Ruski Report
//
//  Provides consistent accessible error and success feedback for account forms.
//

import SwiftUI

struct AccountErrorText: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.circle")
            .font(.caption)
            .foregroundStyle(.red)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("account.error")
    }
}

struct AccountNoticeText: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "checkmark.circle")
            .font(.caption)
            .foregroundStyle(.green)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("account.deletion.success")
    }
}
