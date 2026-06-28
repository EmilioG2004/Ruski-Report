//
//  SessionAuthorizationTests.swift
//  Ruski ReportTests
//

import Testing
@testable import Ruski_Report

struct SessionAuthorizationTests {
    @Test func guestSessionCanViewButCannotPostComments() {
        let session = UserSession.guest
        let policy = CommentAuthorizationPolicy()

        #expect(session.kind == .guest)
        #expect(session.displayName == "Guest")
        #expect(session.canViewTournamentData)
        #expect(!session.canPostComments)
        #expect(!session.canAccessAdminUploads)
        #expect(
            policy.postingAuthorization(for: session) ==
                .requiresSignIn(message: "Sign in to post comments.")
        )
        #expect(!policy.postingAuthorization(for: session).allowsPosting)
    }

    @Test func authenticatedSessionCanPostCommentsWithoutAdminUploadAccess() {
        let session = UserSession.authenticated(
            UserProfile(
                id: "user-1",
                displayName: "Alex",
                provider: .gameCenter
            )
        )
        let policy = CommentAuthorizationPolicy()

        #expect(session.kind == .authenticated)
        #expect(session.displayName == "Alex")
        #expect(session.canViewTournamentData)
        #expect(session.canPostComments)
        #expect(!session.canAccessAdminUploads)
        #expect(policy.postingAuthorization(for: session) == .allowed)
        #expect(policy.postingAuthorization(for: session).allowsPosting)
    }

    @Test func adminSessionCanPostCommentsAndAccessAdminUploads() {
        let session = UserSession.admin(
            UserProfile(
                id: "admin-1",
                displayName: "Tournament Admin",
                provider: .adminToken
            )
        )

        #expect(session.kind == .admin)
        #expect(session.canViewTournamentData)
        #expect(session.canPostComments)
        #expect(session.canAccessAdminUploads)
    }

    @Test func tauIdProviderCanBackAuthenticatedSessions() {
        let profile = UserProfile(
            id: "tau-user-1",
            displayName: "Tau User",
            provider: .tauId
        )
        let session = UserSession.authenticated(profile)

        #expect(profile.provider == .tauId)
        #expect(session.canPostComments)
    }

    @Test func guestSessionRepositoryDefaultsToGuestViewingSession() async {
        let repository = GuestSessionRepository()

        let session = await repository.currentSession()

        #expect(session == .guest)
        #expect(session.canViewTournamentData)
        #expect(!session.canPostComments)
    }
}
