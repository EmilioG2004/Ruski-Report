//
//  AppScreenStateView.swift
//  Ruski Report
//

import SwiftUI

struct AppLoadingStateView: View {
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
                .controlSize(.large)

            Text(title)
                .font(.headline)

            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(AppLayout.pagePadding)
    }
}

struct AppErrorStateView: View {
    let title: String
    let message: String
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button(action: retry) {
                Label("Retry", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.borderedProminent)
        }
    }
}

struct AppEmptyStateView: View {
    let title: String
    let message: String?
    let systemImage: String

    init(
        title: String,
        message: String? = nil,
        systemImage: String
    ) {
        self.title = title
        self.message = message
        self.systemImage = systemImage
    }

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            if let message {
                Text(message)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 180)
    }
}
