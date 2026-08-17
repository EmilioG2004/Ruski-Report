//
//  MatchDetailView.swift
//  Ruski Report
//
//  Owns game loading and destination selection. The loaded layout keeps game
//  context fixed while each destination controls its own scrolling behavior.
//

import SwiftUI

struct MatchDetailView: View {
    @StateObject private var controller: MatchDetailController
    @State private var selectedPanel: MatchDetailPanel = .overview

    private let routeContext: MatchRouteContext
    private let comments: any CommentRepository
    private let commentReports: any CommentReportingRepository
    private let userBlocking: UserBlockingStore
    private let session: AccountSessionStore
    private let realtime: any RealtimeUpdateRepository
    private let logger: any AppLogger

    init(
        routeContext: MatchRouteContext,
        matches: any MatchRepository,
        games: any GameRepository,
        comments: any CommentRepository,
        commentReports: any CommentReportingRepository,
        userBlocking: UserBlockingStore,
        session: AccountSessionStore,
        realtime: any RealtimeUpdateRepository,
        logger: any AppLogger
    ) {
        self.routeContext = routeContext
        self.comments = comments
        self.commentReports = commentReports
        self.userBlocking = userBlocking
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
                    title: MatchCopy.loadingTitle,
                    message: MatchCopy.loadingMessage
                )
                    .accessibilityIdentifier("match.loading")
            case .loaded(let screen):
                detailContent(screen)
            case .failed(let message):
                errorContent(message)
            }
        }
        .background(Color.appGroupedBackground)
        .navigationTitle(MatchCopy.navigationTitle)
        .appInlineNavigationTitle()
        .tint(Color.appBrand)
        .task {
            await controller.loadMatch()
        }
        .task {
            await controller.observeRealtimeUpdates()
        }
    }

    private func detailContent(_ screen: MatchDetailScreen) -> some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: AppLayout.contentSpacing) {
                MatchScoreHeaderView(
                    screen: screen,
                    routeContext: routeContext
                )

                MatchPanelPicker(
                    selection: $selectedPanel,
                    commentCount: screen.match.commentsSummary?.count ?? 0
                )
            }
            .padding(AppLayout.pagePadding)
            .frame(
                maxWidth: AppLayout.maximumContentWidth,
                alignment: .leading
            )
            .frame(maxWidth: .infinity)

            Divider()

            panelContent(screen)
                .id(selectedPanel)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
                .animation(AppVisualTokens.selectionAnimation, value: selectedPanel)
        }
        .accessibilityIdentifier("match.detail")
    }

    @ViewBuilder
    private func panelContent(_ screen: MatchDetailScreen) -> some View {
        switch selectedPanel {
        case .overview:
            MatchPanelScrollView {
                MatchOverviewPanel(screen: screen)
            }
        case .plays:
            MatchPanelScrollView {
                MatchEventLogView(
                    screen: screen,
                    routeContext: routeContext
                )
            }
        case .scorecard:
            MatchPanelScrollView {
                MatchScorecardView(scorecard: screen.match.scorecard)
            }
        case .chat:
            MatchCommentsView(
                matchId: screen.match.id,
                comments: comments,
                commentReports: commentReports,
                userBlocking: userBlocking,
                session: session,
                realtime: realtime,
                logger: logger
            )
        }
    }

    private func errorContent(_ message: String) -> some View {
        AppErrorStateView(title: MatchCopy.unavailableTitle, message: message) {
            Task {
                await controller.loadMatch()
            }
        }
        .accessibilityIdentifier("match.error")
    }
}
