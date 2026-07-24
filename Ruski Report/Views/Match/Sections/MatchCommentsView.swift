//
//  MatchCommentsView.swift
//  Ruski Report
//

import SwiftUI

struct MatchCommentsView: View {
    @EnvironmentObject private var sheetRouter: AppSheetRouter
    @ObservedObject private var session: AccountSessionStore
    @ObservedObject private var userBlocking: UserBlockingStore
    @StateObject private var controller: MatchCommentsController
    @StateObject private var reportingController: CommentReportingController
    @State private var draftComment = ""
    @State private var selectedReport: CommentReportPresentation?
    @State private var selectedBlock: BlockUserPresentation?

    init(
        matchId: MatchPreview.ID,
        comments: any CommentRepository,
        commentReports: any CommentReportingRepository,
        userBlocking: UserBlockingStore,
        session: AccountSessionStore,
        realtime: any RealtimeUpdateRepository,
        logger: any AppLogger
    ) {
        self.session = session
        self.userBlocking = userBlocking
        _controller = StateObject(
            wrappedValue: MatchCommentsController(
                matchId: matchId,
                comments: comments,
                session: session,
                realtime: realtime,
                logger: logger
            )
        )
        _reportingController = StateObject(
            wrappedValue: CommentReportingController(
                reports: commentReports,
                session: session,
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
        }
        .task(id: session.current) {
            await controller.loadComments()
        }
        .task {
            await controller.observeRealtimeUpdates()
        }
        .task(id: userBlocking.revision) {
            guard userBlocking.revision > 0 else {
                return
            }
            await controller.refreshComments()
        }
        .sheet(item: $selectedReport) { comment in
            ReportCommentSheet(
                comment: comment,
                controller: reportingController,
                refreshComments: {
                    await controller.refreshComments()
                }
            )
        }
        .confirmationDialog(
            blockDialogTitle,
            isPresented: blockDialogIsPresented,
            titleVisibility: .visible,
            presenting: selectedBlock
        ) { user in
            Button("Block User", role: .destructive) {
                confirmBlock(user)
            }
            .accessibilityIdentifier("match.comments.block.confirm")

            Button("Cancel", role: .cancel) {}
                .accessibilityIdentifier("match.comments.block.cancel")
        } message: { user in
            Text(
                "Comments from \(user.displayName) will be hidden for you. This does not report or remove their comments for anyone else."
            )
        }
    }

    private func loadedContent(_ content: MatchCommentsContent) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if let successMessage = reportingController.state.successMessage {
                Label(successMessage, systemImage: "checkmark.circle")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("match.comments.reportSuccess")
            }

            if let noticeMessage = userBlocking.noticeMessage {
                Label(noticeMessage, systemImage: "checkmark.circle")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("match.comments.blockSuccess")
            }

            if let errorMessage = userBlocking.actionErrorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("match.comments.blockError")
            }

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

                        MatchCommentRowView(
                            comment: comment,
                            report: {
                                beginReport(for: comment)
                            },
                            block: blockAction(for: comment)
                        )
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

    private func beginReport(for comment: MatchComment) {
        guard session.current.canReportComments else {
            sheetRouter.showAccount()
            return
        }

        reportingController.reset()
        selectedReport = CommentReportPresentation(
            commentId: comment.id,
            authorDisplayName: comment.authorDisplayName
        )
    }

    private func blockAction(for comment: MatchComment) -> (() -> Void)? {
        guard let authorUserId = comment.authorUserId,
              authorUserId != session.current.profile?.id else {
            return nil
        }

        return {
            beginBlock(
                BlockUserPresentation(
                    id: authorUserId,
                    displayName: comment.authorDisplayName
                )
            )
        }
    }

    private func beginBlock(_ user: BlockUserPresentation) {
        guard session.current.canBlockUsers else {
            sheetRouter.showAccount()
            return
        }

        userBlocking.clearMessages()
        selectedBlock = user
    }

    private func confirmBlock(_ user: BlockUserPresentation) {
        selectedBlock = nil
        Task {
            let outcome = await userBlocking.block(user)
            if outcome == .accountUnavailable {
                await controller.refreshComments()
            } else if outcome == .requiresSignIn {
                sheetRouter.showAccount()
            }
        }
    }

    private var blockDialogTitle: String {
        guard let selectedBlock else {
            return "Block User?"
        }
        return "Block \(selectedBlock.displayName)?"
    }

    private var blockDialogIsPresented: Binding<Bool> {
        Binding(
            get: { selectedBlock != nil },
            set: { isPresented in
                if !isPresented {
                    selectedBlock = nil
                }
            }
        )
    }
}
