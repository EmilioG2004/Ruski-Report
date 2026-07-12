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
    let session: LocalSessionRepository
    let realtime: any RealtimeUpdateRepository
    let logger: any AppLogger
    let initialTournament: TournamentPreview

    static let preview: AppServices = {
        let logger = NoopAppLogger()

        return AppServices(
            games: PreviewGameRepository(),
            tournaments: PreviewTournamentRepository(),
            matches: PreviewMatchRepository(),
            comments: PreviewCommentRepository(),
            session: LocalSessionRepository(logger: logger),
            realtime: NoopRealtimeUpdateRepository(),
            logger: logger,
            initialTournament: PreviewData.tournamentPreview
        )
    }()

    static func configured(
        bundle: Bundle = .main,
        processInfo: ProcessInfo = .processInfo
    ) -> AppServices {
        if processInfo.arguments.contains(previewLaunchArgument) {
            return preview
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
        let apiClient = URLSessionAPIClient(baseURL: config.apiBaseURL)
        let session = LocalSessionRepository(logger: logger)

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
