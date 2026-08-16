//
//  MatchCommentComposer.swift
//  Ruski Report
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
        VStack(alignment: .leading, spacing: 10) {
            TextField("Add a comment", text: $draft, axis: .vertical)
                .lineLimit(2...4)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("match.comments.input")

            Button(action: submit) {
                Group {
                    if isPosting {
                        ProgressView()
                    } else {
                        Label("Post Comment", systemImage: "paperplane.fill")
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(isPosting || trimmedDraft.isEmpty)
            .accessibilityIdentifier("match.comments.post")

            errorText
        }
    }

    private func guestPrompt(message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(message, systemImage: "person.crop.circle.badge.exclamationmark")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("match.comments.signInPrompt")

            Button(action: openSignIn) {
                Label("Sign In to Comment", systemImage: "person.crop.circle.badge.plus")
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("match.comments.signIn")

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
