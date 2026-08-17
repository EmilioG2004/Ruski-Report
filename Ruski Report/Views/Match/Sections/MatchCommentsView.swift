//
//  MatchCommentsView.swift
//  Ruski Report
//
//  Owns comment-feed state and composes independent scrolling, an anchored
//  composer, and moderation coordination without embedding policy in rows.
//

import SwiftUI

struct MatchCommentsView: View {
    @EnvironmentObject private var sheetRouter: AppSheetRouter
    @ObservedObject private var session: AccountSessionStore
    @ObservedObject private var userBlocking: UserBlockingStore
    @StateObject private var controller: MatchCommentsController
    @StateObject private var moderation: MatchCommentModerationCoordinator
    @State private var draftComment = ""

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
        _moderation = StateObject(
            wrappedValue: MatchCommentModerationCoordinator(
                reports: commentReports,
                session: session,
                userBlocking: userBlocking,
                logger: logger
            )
        )
    }

    var body: some View {
        commentsPanel
            .task(id: session.current) {
                await controller.loadComments()
            }
            .task {
                await controller.observeRealtimeUpdates()
            }
            .task(id: userBlocking.revision) {
                guard userBlocking.revision > 0 else { return }
                await controller.refreshComments()
            }
            .modifier(
                MatchCommentModerationModifier(
                    coordinator: moderation,
                    refreshComments: controller.refreshComments,
                    showAccount: sheetRouter.showAccount
                )
            )
    }

    @ViewBuilder
    private var commentsPanel: some View {
        switch controller.state {
        case .loading:
            MatchPanelScrollView {
                AppLoadingStateView(
                    title: MatchCopy.loadingComments,
                    message: MatchCopy.loadingCommentsMessage
                )
                    .frame(minHeight: AppLayout.compactStateHeight)
                    .accessibilityIdentifier("match.comments.loading")
            }
        case .loaded(let content):
            loadedPanel(content)
        case .failed(let message):
            MatchPanelScrollView {
                AppErrorStateView(title: MatchCopy.commentsTitle, message: message) {
                    Task { await controller.loadComments() }
                }
                .frame(minHeight: AppLayout.compactStateHeight)
                .accessibilityIdentifier("match.comments.retry")
            }
        }
    }

    private func loadedPanel(_ content: MatchCommentsContent) -> some View {
        ScrollView {
            MatchCommentsFeedView(
                content: content,
                reportingController: moderation.reportingController,
                userBlocking: userBlocking,
                report: beginReport,
                block: blockAction
            )
            .padding(AppLayout.pagePadding)
            .frame(maxWidth: AppLayout.maximumContentWidth, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .accessibilityIdentifier("match.comments.scroll")
        .safeAreaInset(edge: .bottom, spacing: 0) {
            MatchCommentComposerBar(
                authorization: content.postingAuthorization,
                draft: $draftComment,
                isPosting: content.isPosting,
                errorMessage: content.postErrorMessage,
                submit: submitComment,
                openSignIn: sheetRouter.showAccount
            )
        }
    }

    private func submitComment() {
        let body = draftComment
        Task {
            if await controller.postComment(body: body) {
                draftComment = ""
            }
        }
    }

    private func beginReport(_ comment: MatchComment) {
        moderation.beginReport(for: comment, showAccount: sheetRouter.showAccount)
    }

    private func blockAction(_ comment: MatchComment) -> (() -> Void)? {
        moderation.blockAction(for: comment, showAccount: sheetRouter.showAccount)
    }
}
