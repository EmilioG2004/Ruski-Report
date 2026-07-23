//
//  RepositoryTests.swift
//  Ruski ReportTests
//

import Foundation
import Testing
@testable import Ruski_Report

@MainActor
struct RepositoryTests {
    @Test func tournamentRepositoryLoadsActiveTournamentPath() async throws {
        let apiClient = RecordingAPIClient()
        apiClient.responses["tournaments/active"] = tournamentSummaryDTO()
        let repository = RemoteTournamentRepository(apiClient: apiClient)

        let tournament = try await repository.activeTournament()

        #expect(apiClient.requestedPaths == ["tournaments/active"])
        #expect(tournament.id == "tournament-2026")
        #expect(tournament.status == .active)
    }

    @Test func tournamentRepositoryLoadsMatchesPath() async throws {
        let apiClient = RecordingAPIClient()
        apiClient.responses["tournaments/tournament-2026/matches"] = [
            matchSummaryDTO()
        ]
        let repository = RemoteTournamentRepository(apiClient: apiClient)

        let matches = try await repository.matches(tournamentId: "tournament-2026")

        #expect(apiClient.requestedPaths == ["tournaments/tournament-2026/matches"])
        #expect(matches.map(\.id) == ["match-1"])
    }

    @Test func tournamentRepositoryLoadsDetailPathAndMapsSections() async throws {
        let apiClient = RecordingAPIClient()
        apiClient.responses["tournaments/tournament-2026"] = tournamentDetailDTO()
        let repository = RemoteTournamentRepository(apiClient: apiClient)

        let detail = try await repository.tournament(id: "tournament-2026")

        #expect(apiClient.requestedPaths == ["tournaments/tournament-2026"])
        #expect(detail.id == "tournament-2026")
        #expect(detail.pods.map(\.id) == ["pod-a"])
        #expect(detail.matches.map(\.id) == ["match-1"])
        #expect(detail.bracket?.rounds.first?.matchIds == ["match-1"])
        #expect(detail.bracket?.rounds.first?.matches.first?.slots.count == 2)
        #expect(detail.standings.first?.shootingPercentage == 0.556)
        #expect(detail.statistics.first?.rows.first?.values["makes"] == 10)
    }

    @Test func matchRepositoryLoadsMatchDetailPath() async throws {
        let apiClient = RecordingAPIClient()
        apiClient.responses["matches/match-1"] = matchDetailDTO()
        let repository = RemoteMatchRepository(apiClient: apiClient)

        let match = try await repository.match(id: "match-1")

        #expect(apiClient.requestedPaths == ["matches/match-1"])
        #expect(match.id == "match-1")
        #expect(match.boxScore?.rows.first?.stats["dis"] == 1)
        #expect(match.scorecard?.columns.map(\.key) == ["shotNumber", "shooter", "di"])
        #expect(match.events.first?.type == "di")
        #expect(match.commentsSummary?.count == 1)
    }

    @Test func gameRepositoryMapsGameDefinitions() async throws {
        let apiClient = RecordingAPIClient()
        apiClient.responses["games"] = [gameDefinitionDTO()]
        let repository = RemoteGameRepository(apiClient: apiClient)

        let games = try await repository.games()

        #expect(apiClient.requestedPaths == ["games"])
        #expect(games.first?.gameType == "ruski")
        #expect(games.first?.displayName == "Ruski")
        #expect(games.first?.eventTypes.map(\.label) == ["Di", "Guy"])
        #expect(games.first?.stats.map(\.key) == [
            "makes",
            "shootingPercentage",
            "dis"
        ])
    }

    @Test func gameRepositoryDefaultsMissingOptionalEventFlags() async throws {
        let apiClient = RecordingAPIClient()
        apiClient.responses["games"] = [
            GameDefinitionDTO(
                gameType: "ruski",
                displayName: "Ruski",
                scorecardDefinitionId: "ruski-scorecard",
                phases: [
                    GamePhaseDefinitionDTO(
                        id: "normal",
                        label: "Normal Play",
                        sequence: 1
                    )
                ],
                eventTypes: [
                    GameEventTypeDefinitionDTO(
                        id: "vom",
                        label: "Vom",
                        category: "penalty",
                        affectsScore: nil,
                        countsAsAttempt: nil,
                        statKey: "voms"
                    )
                ],
                stats: []
            )
        ]
        let repository = RemoteGameRepository(apiClient: apiClient)

        let games = try await repository.games()

        #expect(games.first?.eventTypes.first?.affectsScore == false)
        #expect(games.first?.eventTypes.first?.countsAsAttempt == false)
    }

    @Test func commentRepositoryLoadsMatchCommentsPath() async throws {
        let apiClient = RecordingAPIClient()
        apiClient.responses["matches/match-1/comments"] = [commentDTO()]
        let repository = RemoteCommentRepository(
            apiClient: apiClient,
            session: StubSessionRepository()
        )

        let comments = try await repository.comments(matchId: "match-1")

        #expect(apiClient.requestedPaths == ["matches/match-1/comments"])
        #expect(comments.map(\.id) == ["comment-1"])
        #expect(comments.first?.matchId == "match-1")
    }

    @Test func commentRepositoryPostsOnlyTheCommentBody() async throws {
        let apiClient = RecordingAPIClient()
        apiClient.responses["matches/match-1/comments"] = commentDTO()
        let repository = RemoteCommentRepository(
            apiClient: apiClient,
            session: StubSessionRepository(
                session: .authenticated(
                    UserProfile(
                        id: "user-1",
                        displayName: "Alex",
                        provider: .gameCenter
                    )
                )
            )
        )

        let comment = try await repository.postComment(
            matchId: "match-1",
            body: "Great match."
        )

        #expect(apiClient.requestedPaths == ["matches/match-1/comments"])
        #expect(comment.id == "comment-1")
        #expect(
            apiClient.postedBodies["matches/match-1/comments"] as? CreateCommentRequestDTO ==
                CreateCommentRequestDTO(body: "Great match.")
        )
    }

    @Test func authenticationRepositoryMapsCreatedSession() async throws {
        let apiClient = RecordingAPIClient()
        apiClient.responses["auth/login"] = CreatedSessionDTO(
            user: AuthenticatedUserDTO(
                id: "user-1",
                displayName: "Alex",
                provider: "local_account"
            ),
            expiresAt: "2026-08-20T12:00:00.000Z",
            token: "opaque-token"
        )
        let repository = RemoteAuthenticationRepository(apiClient: apiClient)

        let session = try await repository.login(
            displayName: "Alex",
            password: "password-123"
        )

        #expect(apiClient.requestedPaths == ["auth/login"])
        #expect(
            apiClient.postedBodies["auth/login"] as? AuthCredentialsDTO ==
                AuthCredentialsDTO(
                    displayName: "Alex",
                    password: "password-123"
                )
        )
        #expect(session.profile.id == "user-1")
        #expect(session.profile.provider == .localAccount)
        #expect(session.token == "opaque-token")
    }

    @Test func authenticationRepositoryDeletesTheCurrentAccount() async throws {
        let apiClient = RecordingAPIClient()
        let repository = RemoteAuthenticationRepository(apiClient: apiClient)

        try await repository.deleteAccount()

        #expect(apiClient.requestedPaths == ["auth/account"])
    }
}
