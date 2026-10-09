//
//  MatchCommentsFeedView.swift
//  Ruski Report
//
//  Renders the conversation and feedback states while moderation and composer
//  workflows remain injected collaborators.
//

import SwiftUI

struct MatchCommentsFeedView: View {
    let content: MatchCommentsContent
    @ObservedObject var reportingController: CommentReportingController
    @ObservedObject var userBlocking: UserBlockingStore
    let report: (MatchComment) -> Void
    let block: (MatchComment) -> (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.contentSpacing) {
            AppSectionHeader(
                MatchCopy.commentsTitle,
                subtitle: MatchCopy.conversationSubtitle,
                count: content.comments.count
            )

            feedbackMessages

            if content.comments.isEmpty {
                EmptyMatchSectionView(
                    title: MatchCopy.noComments,
                    systemImage: "text.bubble"
                )
            } else {
                LazyVStack(alignment: .leading, spacing: AppLayout.compactSpacing) {
                    ForEach(content.comments) { comment in
                        MatchCommentRowView(
                            comment: comment,
                            report: { report(comment) },
                            block: block(comment)
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var feedbackMessages: some View {
        if let message = reportingController.state.successMessage {
            feedbackLabel(
                message,
                systemImage: "checkmark.circle",
                identifier: "match.comments.reportSuccess"
            )
        }

        if let message = userBlocking.noticeMessage {
            feedbackLabel(
                message,
                systemImage: "checkmark.circle",
                identifier: "match.comments.blockSuccess"
            )
        }

        if let message = userBlocking.actionErrorMessage {
            feedbackLabel(
                message,
                systemImage: "exclamationmark.triangle",
                identifier: "match.comments.blockError"
            )
        }
    }

    private func feedbackLabel(
        _ message: String,
        systemImage: String,
        identifier: String
    ) -> some View {
        Label(message, systemImage: systemImage)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier(identifier)
    }
}
