//
//  UserBlockingStoreTests.swift
//  Ruski ReportTests
//

import Testing
@testable import Ruski_Report

@MainActor
struct UserBlockingStoreTests {
    @Test func loadsTheCurrentAccountsBlockedUsers() async {
        let users = [
            blockedUser(
                id: "user-2",
                displayName: "Blocked Player",
                blockedAt: "2026-07-23T12:00:00.000Z"
            )
        ]
        let repository = StubUserBlockingRepository(
            blockedUsersResult: .success(users)
        )
        let store = makeStore(blocking: repository)

        await store.synchronizeWithCurrentSession()

        #expect(store.loadState == .loaded)
        #expect(store.blockedUsers == users)
        #expect(repository.blockedUsersRequestCount == 1)
    }

    @Test func appliesABlockImmediatelyAndAdvancesTheFeedRevision() async {
        let repository = StubUserBlockingRepository()
        let store = makeStore(blocking: repository)

        let outcome = await store.block(
            BlockUserPresentation(
                id: "user-2",
                displayName: "Blocked Player"
            )
        )

        #expect(outcome == .blocked)
        #expect(store.blockedUsers.map(\.id) == ["user-2"])
        #expect(store.revision == 1)
        #expect(repository.blockRequests == ["user-2"])
        #expect(store.noticeMessage == "Blocked Player is now blocked.")
    }

    @Test func rejectsSelfBlockingWithoutCallingTheRepository() async {
        let repository = StubUserBlockingRepository()
        let store = makeStore(blocking: repository)

        let outcome = await store.block(
            BlockUserPresentation(id: "user-1", displayName: "Viewer")
        )

        #expect(outcome == .failed)
        #expect(repository.blockRequests.isEmpty)
        #expect(store.actionErrorMessage == "You cannot block your own account.")
    }

    @Test func removesAUserAfterAnIdempotentUnblockResponse() async {
        let user = blockedUser(
            id: "user-2",
            displayName: "Blocked Player",
            blockedAt: "2026-07-23T12:00:00.000Z"
        )
        let repository = StubUserBlockingRepository(
            blockedUsersResult: .success([user]),
            unblockResult: .success(
                UnblockUserReceipt(
                    blockedUserId: user.id,
                    wasBlocked: false
                )
            )
        )
        let store = makeStore(blocking: repository)
        await store.loadBlockedUsers()

        let succeeded = await store.unblock(user)

        #expect(succeeded)
        #expect(store.blockedUsers.isEmpty)
        #expect(store.revision == 1)
        #expect(repository.unblockRequests == [user.id])
    }

    @Test func presentsASafeMessageWhenTheTargetAccountDisappears() async {
        let repository = StubUserBlockingRepository(
            blockResult: .failure(
                AppError.backend(
                    code: "NOT_FOUND",
                    message: "Internal target details.",
                    details: [
                        AppErrorDetail(
                            code: "BLOCKED_ACCOUNT_NOT_FOUND",
                            message: "Internal target details.",
                            path: "userId"
                        )
                    ]
                )
            )
        )
        let store = makeStore(blocking: repository)

        let outcome = await store.block(
            BlockUserPresentation(
                id: "missing-user",
                displayName: "Unavailable Player"
            )
        )

        #expect(outcome == .accountUnavailable)
        #expect(store.actionErrorMessage == "That account is no longer available.")
        #expect(!(store.actionErrorMessage ?? "").contains("Internal"))
    }

    @Test func guestSynchronizationClearsPrivateBlockedState() async {
        let repository = StubUserBlockingRepository()
        let store = UserBlockingStore(
            blocking: repository,
            session: StubSessionRepository(session: .guest),
            logger: NoopAppLogger()
        )

        await store.synchronizeWithCurrentSession()

        #expect(store.loadState == .idle)
        #expect(store.blockedUsers.isEmpty)
        #expect(repository.blockedUsersRequestCount == 0)
    }

    private func makeStore(
        blocking: StubUserBlockingRepository
    ) -> UserBlockingStore {
        UserBlockingStore(
            blocking: blocking,
            session: StubSessionRepository(
                session: .authenticated(
                    UserProfile(id: "user-1", displayName: "Viewer")
                )
            ),
            logger: NoopAppLogger()
        )
    }

    private func blockedUser(
        id: String,
        displayName: String,
        blockedAt: String
    ) -> BlockedUser {
        BlockedUser(
            id: id,
            displayName: displayName,
            blockedAt: blockedAt
        )
    }
}
