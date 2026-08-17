//
//  MatchCommentComposerBar.swift
//  Ruski Report
//
//  Provides the persistent bottom surface that hosts authenticated and guest
//  comment composition states above the device safe area.
//

import SwiftUI

struct MatchCommentComposerBar: View {
    let authorization: CommentPostingAuthorization
    @Binding var draft: String
    let isPosting: Bool
    let errorMessage: String?
    let submit: () -> Void
    let openSignIn: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Divider()

            MatchCommentComposer(
                authorization: authorization,
                draft: $draft,
                isPosting: isPosting,
                errorMessage: errorMessage,
                submit: submit,
                openSignIn: openSignIn
            )
            .padding(.horizontal, AppLayout.pagePadding)
            .padding(.vertical, AppLayout.compactSpacing)
            .frame(maxWidth: AppLayout.maximumContentWidth)
            .frame(maxWidth: .infinity)
        }
        .background(Color.appSecondaryGroupedBackground)
    }
}
