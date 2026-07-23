//
//  MatchDetailView.swift
//  Ruski Report
//

import SwiftUI

struct MatchDetailView: View {
    @StateObject private var controller: MatchDetailController

    private let routeContext: MatchRouteContext
    private let comments: any CommentRepository
    private let commentReports: any CommentReportingRepository
    private let session: AccountSessionStore
    private let realtime: any RealtimeUpdateRepository
    private let logger: any AppLogger

    init(
        routeContext: MatchRouteContext,
        matches: any MatchRepository,
        games: any GameRepository,
        comments: any CommentRepository,
        commentReports: any CommentReportingRepository,
        session: AccountSessionStore,
        realtime: any RealtimeUpdateRepository,
        logger: any AppLogger
    ) {
        self.routeContext = routeContext
        self.comments = comments
        self.commentReports = commentReports
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
                    commentReports: commentReports,
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
