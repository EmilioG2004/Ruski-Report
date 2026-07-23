//
//  SessionAuthorizationTests.swift
//  Ruski ReportTests
//

import Testing
@testable import Ruski_Report

@MainActor
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

    @Test func accountSessionStorePersistsSuccessfulLogin() async throws {
        let credentials = InMemorySessionCredentialStore()
        let repository = StubAuthenticationRepository(
            createdSession: authenticatedAccountSession()
        )
        let store = AccountSessionStore(
            authentication: repository,
            credentials: credentials
        )

        try await store.signIn(displayName: "Jamie", password: "password-123")

        #expect(await credentials.accessToken() == "opaque-token")
        #expect(
            await store.currentSession() ==
                .authenticated(authenticatedAccountSession().profile)
        )
        #expect(store.activity == .idle)
    }

    @Test func accountSessionStoreRestoresAStoredServerSession() async {
        let credentials = InMemorySessionCredentialStore(token: "opaque-token")
        let repository = StubAuthenticationRepository(
            currentProfile: .success(authenticatedAccountSession().profile)
        )
        let store = AccountSessionStore(
            authentication: repository,
            credentials: credentials
        )

        await store.restoreSession()

        #expect(
            await store.currentSession() ==
                .authenticated(authenticatedAccountSession().profile)
        )
    }

    @Test func accountSessionStoreClearsAnUnauthorizedStoredSession() async throws {
        let credentials = InMemorySessionCredentialStore(token: "expired-token")
        let repository = StubAuthenticationRepository(
            currentProfile: .failure(
                AppError.backend(
                    code: "UNAUTHORIZED",
                    message: "Sign in to continue.",
                    details: []
                )
            )
        )
        let store = AccountSessionStore(
            authentication: repository,
            credentials: credentials
        )

        await store.restoreSession()

        #expect(await store.currentSession() == .guest)
        #expect(await credentials.accessToken() == nil)
    }

    @Test func unconfirmedAccountDeletionDoesNotLeaveTheClientSignedIn() async {
        let credentials = InMemorySessionCredentialStore(token: "opaque-token")
        let repository = StubAuthenticationRepository(
            currentProfile: .failure(
                AppError.networkUnavailable("Still offline")
            ),
            deleteAccountError: AppError.networkUnavailable("Connection lost")
        )
        let store = AccountSessionStore(
            initialSession: authenticatedUserSession(),
            authentication: repository,
            credentials: credentials
        )

        do {
            try await store.deleteAccount()
            Issue.record("Expected an unknown account deletion status.")
        } catch {
            #expect(
                error as? AccountDeletionError ==
                    .deletionStatusUnknown
            )
        }

        #expect(await store.currentSession() == .guest)
        #expect(await credentials.accessToken() == nil)
    }

    @Test func accountSessionStoreClearsLocalSessionWhenRemoteSignOutFails() async throws {
        let credentials = InMemorySessionCredentialStore(token: "opaque-token")
        let repository = StubAuthenticationRepository(
            createdSession: authenticatedAccountSession(),
            signOutError: AppError.networkUnavailable("Offline")
        )
        let store = AccountSessionStore(
            authentication: repository,
            credentials: credentials
        )
        try await store.signIn(displayName: "Jamie", password: "password-123")

        try await store.signOut()

        #expect(await store.currentSession() == .guest)
        #expect(await credentials.accessToken() == nil)
    }

    @Test func accountSessionStoreDeletesAccountAndClearsLocalSession() async throws {
        let credentials = InMemorySessionCredentialStore(token: "opaque-token")
        let repository = StubAuthenticationRepository()
        let store = AccountSessionStore(
            initialSession: authenticatedUserSession(),
            authentication: repository,
            credentials: credentials
        )

        try await store.deleteAccount()

        #expect(repository.deleteAccountCallCount == 1)
        #expect(await store.currentSession() == .guest)
        #expect(await credentials.accessToken() == nil)
        #expect(store.activity == .idle)
    }

    @Test func accountDeletionUnauthorizedRequiresSignInAgain() async {
        let credentials = InMemorySessionCredentialStore(token: "expired-token")
        let repository = StubAuthenticationRepository(
            deleteAccountError: unauthorizedError()
        )
        let store = AccountSessionStore(
            initialSession: authenticatedUserSession(),
            authentication: repository,
            credentials: credentials
        )

        do {
            try await store.deleteAccount()
            Issue.record("Expected account deletion to require reauthentication.")
        } catch {
            #expect(
                error as? AccountDeletionError ==
                    .reauthenticationRequired
            )
        }

        #expect(await store.currentSession() == .guest)
        #expect(await credentials.accessToken() == nil)
        #expect(store.activity == .idle)
    }

    @Test func accountDeletionFailureRetainsConfirmedRemoteSession() async {
        let credentials = InMemorySessionCredentialStore(token: "opaque-token")
        let deletionError = AppError.networkUnavailable("Offline")
        let repository = StubAuthenticationRepository(
            currentProfile: .success(authenticatedAccountSession().profile),
            deleteAccountError: deletionError
        )
        let store = AccountSessionStore(
            initialSession: authenticatedUserSession(),
            authentication: repository,
            credentials: credentials
        )

        do {
            try await store.deleteAccount()
            Issue.record("Expected account deletion to fail while offline.")
        } catch {
            #expect(error as? AppError == deletionError)
        }

        #expect(repository.currentProfileCallCount == 1)
        #expect(await store.currentSession() == authenticatedUserSession())
        #expect(await credentials.accessToken() == "opaque-token")
    }

    @Test func ambiguousAccountDeletionClearsAnInvalidRemoteSession() async {
        let credentials = InMemorySessionCredentialStore(token: "opaque-token")
        let repository = StubAuthenticationRepository(
            currentProfile: .failure(unauthorizedError()),
            deleteAccountError: AppError.networkUnavailable("Connection lost")
        )
        let store = AccountSessionStore(
            initialSession: authenticatedUserSession(),
            authentication: repository,
            credentials: credentials
        )

        do {
            try await store.deleteAccount()
            Issue.record("Expected an unknown account deletion status.")
        } catch {
            #expect(
                error as? AccountDeletionError ==
                    .deletionStatusUnknown
            )
        }

        #expect(repository.currentProfileCallCount == 1)
        #expect(await store.currentSession() == .guest)
        #expect(await credentials.accessToken() == nil)
    }

    @Test func accountDeletionReportsLocalCredentialCleanupFailure() async {
        let credentials = FailingClearSessionCredentialStore(
            token: "opaque-token"
        )
        let store = AccountSessionStore(
            initialSession: authenticatedUserSession(),
            authentication: StubAuthenticationRepository(),
            credentials: credentials
        )

        do {
            try await store.deleteAccount()
            Issue.record("Expected local credential cleanup to fail.")
        } catch {
            #expect(
                error as? AccountDeletionError ==
                    .localCredentialCleanupFailed
            )
        }

        #expect(await store.currentSession() == .guest)
        #expect(await credentials.accessToken() == "opaque-token")
    }
}

private func authenticatedAccountSession() -> AuthenticatedAccountSession {
    AuthenticatedAccountSession(
        profile: UserProfile(
            id: "user-1",
            displayName: "Jamie",
            provider: .localAccount
        ),
        token: "opaque-token",
        expiresAt: "2026-08-20T12:00:00.000Z"
    )
}

private func authenticatedUserSession() -> UserSession {
    .authenticated(authenticatedAccountSession().profile)
}

private func unauthorizedError() -> AppError {
    .backend(
        code: "UNAUTHORIZED",
        message: "Sign in to continue.",
        details: []
    )
}

private final class StubAuthenticationRepository: AuthenticationRepository {
    private let createdSession: AuthenticatedAccountSession
    private let currentProfileResult: Result<UserProfile, Error>
    private let signOutError: Error?
    private let deleteAccountError: Error?
    private(set) var currentProfileCallCount = 0
    private(set) var deleteAccountCallCount = 0

    init(
        createdSession: AuthenticatedAccountSession = authenticatedAccountSession(),
        currentProfile: Result<UserProfile, Error> = .success(
            authenticatedAccountSession().profile
        ),
        signOutError: Error? = nil,
        deleteAccountError: Error? = nil
    ) {
        self.createdSession = createdSession
        currentProfileResult = currentProfile
        self.signOutError = signOutError
        self.deleteAccountError = deleteAccountError
    }

    func register(
        displayName: String,
        password: String
    ) async throws -> AuthenticatedAccountSession {
        createdSession
    }

    func login(
        displayName: String,
        password: String
    ) async throws -> AuthenticatedAccountSession {
        createdSession
    }

    func currentProfile() async throws -> UserProfile {
        currentProfileCallCount += 1
        return try currentProfileResult.get()
    }

    func signOut() async throws {
        if let signOutError {
            throw signOutError
        }
    }

    func deleteAccount() async throws {
        deleteAccountCallCount += 1

        if let deleteAccountError {
            throw deleteAccountError
        }
    }
}

private actor FailingClearSessionCredentialStore: SessionCredentialStore {
    private var token: String?

    init(token: String?) {
        self.token = token
    }

    func accessToken() -> String? {
        token
    }

    func saveAccessToken(_ token: String) {
        self.token = token
    }

    func clearAccessToken() throws {
        throw AppError.secureStorage("Unable to clear the saved session.")
    }
}
