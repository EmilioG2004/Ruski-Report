//
//  AppServices.swift
//  Ruski Report
//

import Foundation

struct AppServices {
    static let previewLaunchArgument = "--use-preview-services"

    let games: any GameRepository
    let tournaments: any TournamentRepository
    let matches: any MatchRepository
    let comments: any CommentRepository
    let commentReports: any CommentReportingRepository
    let userBlocking: any UserBlockingRepository
    let session: AccountSessionStore
    let realtime: any RealtimeUpdateRepository
    let logger: any AppLogger
    let initialTournament: TournamentPreview
    let policyLinks: AppPolicyLinks

    static let preview = preview(scenario: .standard)

    static func preview(scenario: PreviewScenario) -> AppServices {
        let logger = NoopAppLogger()
        let profile = UserProfile(
            id: "preview-user",
            displayName: "Emilio Garcia",
            provider: .localAccount
        )
        let isAuthenticated =
            scenario == .authenticated ||
            scenario == .moderationRejected ||
            scenario == .reporting ||
            scenario == .reportUnavailable ||
            scenario == .blocking
        let tournamentDetail: TournamentDetail
        switch scenario {
        case .empty:
            tournamentDetail = PreviewData.emptyTournamentDetail
        case .longContent:
            tournamentDetail = PreviewData.longContentTournamentDetail
        default:
            tournamentDetail = PreviewData.tournamentDetail
        }
        let tournamentNetworkCondition: PreviewNetworkCondition = switch scenario {
        case .unavailable:
            .unavailable
        case .recovering:
            .delayedRecovery
        default:
            .available
        }

        let blockingState = PreviewUserBlockingState()

        return AppServices(
            games: PreviewGameRepository(),
            tournaments: PreviewTournamentRepository(
                detail: tournamentDetail,
                networkCondition: tournamentNetworkCondition
            ),
            matches: PreviewMatchRepository(),
            comments: PreviewCommentRepository(
                blockingState: blockingState,
                postError: previewCommentPostError(for: scenario)
            ),
            commentReports: PreviewCommentReportingRepository(
                result: previewCommentReportResult(for: scenario)
            ),
            userBlocking: PreviewUserBlockingRepository(state: blockingState),
            session: AccountSessionStore(
                initialSession: isAuthenticated ? .authenticated(profile) : .guest,
                authentication: PreviewAuthenticationRepository(profile: profile),
                credentials: InMemorySessionCredentialStore(
                    token: isAuthenticated ? "preview-session-token" : nil
                ),
                logger: logger
            ),
            realtime: NoopRealtimeUpdateRepository(),
            logger: logger,
            initialTournament: tournamentDetail.preview,
            policyLinks: .productionFallback
        )
    }

    private static func previewCommentPostError(
        for scenario: PreviewScenario
    ) -> Error {
        guard scenario == .moderationRejected else {
            return AppError.unsupported("Preview comments are read-only.")
        }

        return AppError.backend(
            code: "VALIDATION_FAILED",
            message: "Unsafe backend moderation details.",
            details: [
                AppErrorDetail(
                    code: "COMMENT_CONTENT_NOT_ALLOWED",
                    message: "Matched a private moderation rule.",
                    path: "body"
                )
            ]
        )
    }

    private static func previewCommentReportResult(
        for scenario: PreviewScenario
    ) -> Result<CommentReportReceipt, Error> {
        if scenario == .reportUnavailable {
            return .failure(
                AppError.backend(
                    code: "NOT_FOUND",
                    message: "Unsafe server removal details.",
                    details: [
                        AppErrorDetail(
                            code: "COMMENT_NOT_AVAILABLE",
                            message: "Internal comment lookup failed.",
                            path: "commentId"
                        )
                    ]
                )
            )
        }

        return .success(
            CommentReportReceipt(
                id: "report-preview",
                status: "open",
                submittedAt: "2026-07-23T12:00:00.000Z",
                alreadyReported: false
            )
        )
    }

    static func configured(
        bundle: Bundle = .main,
        processInfo: ProcessInfo = .processInfo
    ) -> AppServices {
        if processInfo.arguments.contains(previewLaunchArgument) {
            return preview(
                scenario: PreviewScenario.resolve(from: processInfo.arguments)
            )
        }

        let logger = OSLogAppLogger()
        let config: AppConfig

        do {
            config = try AppConfig.load(bundle: bundle, processInfo: processInfo)
        } catch {
            logger.log(
                .warning,
                "Unable to load app config; using fallback configuration",
                metadata: ["error": String(describing: error)]
            )
            config = .fallback
        }

        return live(config: config, logger: logger)
    }

    static func live(
        config: AppConfig = .fallback,
        logger: any AppLogger = OSLogAppLogger()
    ) -> AppServices {
        let credentials = KeychainSessionCredentialStore()
        let apiClient = URLSessionAPIClient(
            baseURL: config.apiBaseURL,
            authorizer: BearerTokenRequestAuthorizer(credentials: credentials)
        )
        let session = AccountSessionStore(
            authentication: RemoteAuthenticationRepository(apiClient: apiClient),
            credentials: credentials,
            logger: logger
        )

        return AppServices(
            games: RemoteGameRepository(apiClient: apiClient),
            tournaments: RemoteTournamentRepository(apiClient: apiClient),
            matches: RemoteMatchRepository(apiClient: apiClient),
            comments: RemoteCommentRepository(apiClient: apiClient, session: session),
            commentReports: RemoteCommentReportingRepository(
                apiClient: apiClient,
                session: session
            ),
            userBlocking: RemoteUserBlockingRepository(
                apiClient: apiClient,
                session: session
            ),
            session: session,
            realtime: URLSessionSocketIORealtimeUpdateRepository(
                apiBaseURL: config.apiBaseURL,
                logger: logger
            ),
            logger: logger,
            initialTournament: PreviewData.tournamentPreview,
            policyLinks: config.policyLinks
        )
    }
}
