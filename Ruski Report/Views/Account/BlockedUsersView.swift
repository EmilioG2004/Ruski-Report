//
//  BlockedUsersView.swift
//  Ruski Report
//

import SwiftUI

struct BlockedUsersView: View {
    @ObservedObject var blocking: UserBlockingStore

    var body: some View {
        Group {
            switch blocking.loadState {
            case .idle, .loading:
                ProgressView("Loading blocked users")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityIdentifier("account.blocks.loading")
            case .loaded:
                blockedUsersList
            case .failed(let message):
                failureView(message)
            }
        }
        .background(Color.appGroupedBackground)
        .navigationTitle("Blocked Users")
        .appInlineNavigationTitle()
        .task {
            await blocking.loadBlockedUsers()
        }
    }

    private var blockedUsersList: some View {
        List {
            if let noticeMessage = blocking.noticeMessage {
                Section {
                    Label(noticeMessage, systemImage: "checkmark.circle")
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("account.blocks.notice")
                }
            }

            if let errorMessage = blocking.actionErrorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("account.blocks.error")
                }
            }

            if blocking.blockedUsers.isEmpty {
                ContentUnavailableView(
                    "No Blocked Users",
                    systemImage: "person.crop.circle.badge.checkmark",
                    description: Text(
                        "Accounts you block from match comments will appear here."
                    )
                )
                .accessibilityIdentifier("account.blocks.empty")
            } else {
                Section {
                    ForEach(blocking.blockedUsers) { user in
                        blockedUserRow(user)
                    }
                } footer: {
                    Text(
                        "Unblocking an account restores their comments the next time a match feed refreshes."
                    )
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable {
            await blocking.loadBlockedUsers()
        }
        .accessibilityIdentifier("account.blocks.list")
    }

    private func blockedUserRow(_ user: BlockedUser) -> some View {
        HStack(spacing: 12) {
            Label(user.displayName, systemImage: "person.crop.circle.fill")
                .lineLimit(2)

            Spacer()

            Button("Unblock") {
                Task {
                    await blocking.unblock(user)
                }
            }
            .disabled(blocking.isMutating(userId: user.id))
            .accessibilityIdentifier("account.blocks.unblock.\(user.id)")
        }
    }

    private func failureView(_ message: String) -> some View {
        VStack(spacing: 12) {
            Label(message, systemImage: "exclamationmark.triangle")
                .multilineTextAlignment(.center)

            Button {
                Task {
                    await blocking.loadBlockedUsers()
                }
            } label: {
                Label("Retry", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("account.blocks.retry")
        }
        .padding()
        .accessibilityIdentifier("account.blocks.failure")
    }
}
