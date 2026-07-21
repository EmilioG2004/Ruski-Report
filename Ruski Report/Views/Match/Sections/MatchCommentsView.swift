//
//  MatchCommentsView.swift
//  Ruski Report
//

import SwiftUI

struct MatchCommentsView: View {
    @EnvironmentObject private var sheetRouter: AppSheetRouter
    @ObservedObject private var session: AccountSessionStore
    @StateObject private var controller: MatchCommentsController
    @State private var draftComment = ""

    init(
        matchId: MatchPreview.ID,
        comments: any CommentRepository,
        session: AccountSessionStore,
        realtime: any RealtimeUpdateRepository,
        logger: any AppLogger
    ) {
        self.session = session
        _controller = StateObject(
            wrappedValue: MatchCommentsController(
                matchId: matchId,
                comments: comments,
                session: session,
                realtime: realtime,
                logger: logger
            )
        )
    }

    var body: some View {
        MatchSectionView(title: "Comments", systemImage: "text.bubble") {
            Group {
                switch controller.state {
                case .loading:
                    ProgressView("Loading comments")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 12)
                        .accessibilityIdentifier("match.comments.loading")
                case .loaded(let content):
                    loadedContent(content)
                case .failed(let message):
                    failedContent(message)
                }
            }
            .accessibilityIdentifier("match.comments")
        }
        .task(id: session.current) {
            await controller.loadComments()
        }
        .task {
            await controller.observeRealtimeUpdates()
        }
    }

    private func loadedContent(_ content: MatchCommentsContent) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if content.comments.isEmpty {
                EmptyMatchSectionView(
                    title: "No comments yet",
                    systemImage: "text.bubble"
                )
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(
                        Array(content.comments.enumerated()),
                        id: \.element.id
                    ) { index, comment in
                        if index > 0 {
                            Divider()
                        }

                        MatchCommentRowView(comment: comment)
                    }
                }
            }

            MatchCommentComposer(
                authorization: content.postingAuthorization,
                draft: $draftComment,
                isPosting: content.isPosting,
                errorMessage: content.postErrorMessage,
                submit: submitComment,
                openSignIn: sheetRouter.showAccount
            )
        }
    }

    private func failedContent(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(message, systemImage: "exclamationmark.triangle")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                Task {
                    await controller.loadComments()
                }
            } label: {
                Label("Retry", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("match.comments.retry")
        }
        .padding(.vertical, 8)
    }

    private func submitComment() {
        let body = draftComment
        Task {
            if await controller.postComment(body: body) {
                draftComment = ""
            }
        }
    }
}
