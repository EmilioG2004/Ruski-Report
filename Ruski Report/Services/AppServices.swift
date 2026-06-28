//
//  AppServices.swift
//  Ruski Report
//

import Foundation

nonisolated struct AppServices {
    static let previewLaunchArgument = "--use-preview-services"

    let games: any GameRepository
    let tournaments: any TournamentRepository
    let matches: any MatchRepository
    let comments: any CommentRepository
    let session: any SessionRepository
    let realtime: any RealtimeUpdateRepository
    let logger: any AppLogger
    let initialTournament: TournamentPreview

    static let preview = AppServices(
        games: PreviewGameRepository(),
        tournaments: PreviewTournamentRepository(),
        matches: PreviewMatchRepository(),
        comments: PreviewCommentRepository(),
        session: GuestSessionRepository(),
        realtime: NoopRealtimeUpdateRepository(),
        logger: NoopAppLogger(),
        initialTournament: PreviewData.tournamentPreview
    )

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
        let session = GuestSessionRepository()

        return AppServices(
            games: RemoteGameRepository(apiClient: apiClient),
            tournaments: RemoteTournamentRepository(apiClient: apiClient),
            matches: RemoteMatchRepository(apiClient: apiClient),
            comments: RemoteCommentRepository(apiClient: apiClient, session: session),
            session: session,
            realtime: NoopRealtimeUpdateRepository(),
            logger: logger,
            initialTournament: PreviewData.tournamentPreview
        )
    }
}
