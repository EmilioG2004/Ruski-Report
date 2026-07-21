//
//  MatchDetailView.swift
//  Ruski Report
//

import Foundation
import SwiftUI

struct MatchDetailView: View {
    @StateObject private var controller: MatchDetailController

    private let routeContext: MatchRouteContext
    private let comments: any CommentRepository
    private let session: AccountSessionStore
    private let realtime: any RealtimeUpdateRepository
    private let logger: any AppLogger

    init(
        routeContext: MatchRouteContext,
        matches: any MatchRepository,
        games: any GameRepository,
        comments: any CommentRepository,
        session: AccountSessionStore,
        realtime: any RealtimeUpdateRepository,
        logger: any AppLogger
    ) {
        self.routeContext = routeContext
        self.comments = comments
        self.session = session
        self.realtime = realtime
        self.logger = logger
        _controller = StateObject(
            wrappedValue: MatchDetailController(
                matchId: routeContext.matchId,
                tournamentId: routeContext.tournamentId,
                matches: matches,
                games: games,
                realtime: realtime,
                logger: logger
            )
        )
    }

    var body: some View {
        Group {
            switch controller.state {
            case .loading:
                AppLoadingStateView(
                    title: "Loading match",
                    message: "Fetching the official scorecard and match activity."
                )
                    .accessibilityIdentifier("match.loading")
            case .loaded(let screen):
                detailContent(screen)
            case .failed(let message):
                errorContent(message)
            }
        }
        .background(Color.appGroupedBackground)
        .navigationTitle("Match")
        .appInlineNavigationTitle()
        .task {
            await controller.loadMatch()
        }
        .task {
            await controller.observeRealtimeUpdates()
        }
    }

    private func detailContent(_ screen: MatchDetailScreen) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                MatchScoreHeaderView(
                    screen: screen,
                    routeContext: routeContext
                )

                MatchBoxScoreView(screen: screen)

                MatchScorecardView(scorecard: screen.match.scorecard)

                MatchEventLogView(
                    screen: screen,
                    routeContext: routeContext
                )

                MatchCommentsView(
                    matchId: screen.match.id,
                    comments: comments,
                    session: session,
                    realtime: realtime,
                    logger: logger
                )
            }
            .padding(AppLayout.pagePadding)
            .frame(
                maxWidth: AppLayout.maximumContentWidth,
                alignment: .leading
            )
            .frame(maxWidth: .infinity)
        }
        .accessibilityIdentifier("match.detail")
    }

    private func errorContent(_ message: String) -> some View {
        AppErrorStateView(title: "Match unavailable", message: message) {
            Task {
                await controller.loadMatch()
            }
        }
        .accessibilityIdentifier("match.error")
    }
}

private struct MatchCommentsView: View {
    @StateObject private var controller: MatchCommentsController
    @ObservedObject private var session: AccountSessionStore
    @EnvironmentObject private var sheetRouter: AppSheetRouter
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
                    ForEach(Array(content.comments.enumerated()), id: \.element.id) { index, comment in
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
