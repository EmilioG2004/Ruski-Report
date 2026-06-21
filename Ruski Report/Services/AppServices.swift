//
//  AppServices.swift
//  Ruski Report
//

import Foundation

nonisolated struct AppServices {
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

    static func live(
        baseURL: URL = URL(string: "http://localhost:3000/api")!
    ) -> AppServices {
        let apiClient = URLSessionAPIClient(baseURL: baseURL)

        return AppServices(
            games: RemoteGameRepository(apiClient: apiClient),
            tournaments: RemoteTournamentRepository(apiClient: apiClient),
            matches: RemoteMatchRepository(apiClient: apiClient),
            comments: RemoteCommentRepository(apiClient: apiClient),
            session: GuestSessionRepository(),
            realtime: NoopRealtimeUpdateRepository(),
            logger: OSLogAppLogger(),
            initialTournament: PreviewData.tournamentPreview
        )
    }
}
