//
//  MatchCommentComposer.swift
//  Ruski Report
//
//  Renders compact authenticated and guest composer states for the persistent
//  bottom bar without owning posting or account policy.
//

import Foundation
import SwiftUI

struct MatchCommentComposer: View {
    let authorization: CommentPostingAuthorization
    @Binding var draft: String
    let isPosting: Bool
    let errorMessage: String?
    let submit: () -> Void
    let openSignIn: () -> Void

    var body: some View {
        switch authorization {
        case .allowed:
            authenticatedComposer
        case .requiresSignIn(let message):
            guestPrompt(message: message)
        }
    }

    private var authenticatedComposer: some View {
        VStack(alignment: .leading, spacing: AppLayout.smallSpacing) {
            HStack(alignment: .bottom, spacing: AppLayout.smallSpacing) {
                TextField(MatchCopy.commentPlaceholder, text: $draft, axis: .vertical)
                    .lineLimit(1...3)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("match.comments.input")

                Button(action: submit) {
                    Group {
                        if isPosting {
                            ProgressView()
                        } else {
                            Image(systemName: "paperplane.fill")
                        }
                    }
                    .frame(
                        width: AppLayout.controlHeight,
                        height: AppLayout.controlHeight
                    )
                }
                .buttonStyle(.borderedProminent)
                .disabled(isPosting || trimmedDraft.isEmpty)
                .accessibilityLabel(MatchCopy.postComment)
                .accessibilityIdentifier("match.comments.post")
            }

            errorText
        }
    }

    private func guestPrompt(message: String) -> some View {
        VStack(alignment: .leading, spacing: AppLayout.smallSpacing) {
            HStack(spacing: AppLayout.standardSpacing) {
                Label(message, systemImage: "person.crop.circle.badge.exclamationmark")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("match.comments.signInPrompt")

                Button(action: openSignIn) {
                    Text(MatchCopy.signIn)
                }
                .buttonStyle(.bordered)
                .fixedSize()
                .accessibilityLabel(MatchCopy.signInToComment)
                .accessibilityIdentifier("match.comments.signIn")
            }

            errorText
        }
    }

    @ViewBuilder
    private var errorText: some View {
        if let errorMessage {
            Text(errorMessage)
                .font(.caption)
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("match.comments.postError")
        }
    }

    private var trimmedDraft: String {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
