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
    let session: AccountSessionStore
    let realtime: any RealtimeUpdateRepository
    let logger: any AppLogger
    let initialTournament: TournamentPreview

    static let preview = preview(scenario: .standard)

    static func preview(scenario: PreviewScenario) -> AppServices {
        let logger = NoopAppLogger()
        let profile = UserProfile(
            id: "preview-user",
            displayName: "Emilio Garcia",
            provider: .localAccount
        )
        let isAuthenticated =
            scenario == .authenticated || scenario == .moderationRejected
        let tournamentDetail = scenario == .empty ?
            PreviewData.emptyTournamentDetail : PreviewData.tournamentDetail
        let tournamentFailure: AppError? = scenario == .unavailable ?
            .networkUnavailable("The tournament service is temporarily unavailable.") : nil

        return AppServices(
            games: PreviewGameRepository(),
            tournaments: PreviewTournamentRepository(
                detail: tournamentDetail,
                failure: tournamentFailure
            ),
            matches: PreviewMatchRepository(),
            comments: PreviewCommentRepository(
                postError: previewCommentPostError(for: scenario)
            ),
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
            initialTournament: PreviewData.tournamentPreview
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
                "Unable to load app config; using fallback API base URL",
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
            session: session,
            realtime: URLSessionSocketIORealtimeUpdateRepository(
                apiBaseURL: config.apiBaseURL,
                logger: logger
            ),
            logger: logger,
            initialTournament: PreviewData.tournamentPreview
        )
    }
}
