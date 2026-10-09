//
//  MatchCommentModerationModifier.swift
//  Ruski Report
//
//  Encapsulates comment moderation sheets and confirmation dialogs so the feed
//  view can focus on state composition and scrolling.
//

import SwiftUI

struct MatchCommentModerationModifier: ViewModifier {
    @ObservedObject var coordinator: MatchCommentModerationCoordinator

    let refreshComments: () async -> Void
    let showAccount: () -> Void

    func body(content: Content) -> some View {
        content
            .sheet(item: $coordinator.selectedReport) { comment in
                ReportCommentSheet(
                    comment: comment,
                    controller: coordinator.reportingController,
                    refreshComments: refreshComments
                )
            }
            .confirmationDialog(
                coordinator.blockDialogTitle,
                isPresented: blockDialogIsPresented,
                titleVisibility: .visible,
                presenting: coordinator.selectedBlock
            ) { user in
                Button("Block User", role: .destructive) {
                    confirmBlock(user)
                }
                .accessibilityIdentifier("match.comments.block.confirm")

                Button("Cancel", role: .cancel) {}
                    .accessibilityIdentifier("match.comments.block.cancel")
            } message: { user in
                Text(
                    "Comments from \(user.displayName) will be hidden for you. " +
                    "This does not report or remove their comments for anyone else."
                )
            }
    }

    private func confirmBlock(_ user: BlockUserPresentation) {
        Task {
            let outcome = await coordinator.confirmBlock(user)
            if outcome == .accountUnavailable {
                await refreshComments()
            } else if outcome == .requiresSignIn {
                showAccount()
            }
        }
    }

    private var blockDialogIsPresented: Binding<Bool> {
        Binding(
            get: { coordinator.selectedBlock != nil },
            set: { isPresented in
                if !isPresented {
                    coordinator.selectedBlock = nil
                }
            }
        )
    }
}
