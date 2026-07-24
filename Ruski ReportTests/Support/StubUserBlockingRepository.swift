//
//  StubUserBlockingRepository.swift
//  Ruski ReportTests
//

@testable import Ruski_Report

final class StubUserBlockingRepository: UserBlockingRepository {
    var blockedUsersResult: Result<[BlockedUser], Error>
    var blockResult: Result<BlockUserReceipt, Error>
    var unblockResult: Result<UnblockUserReceipt, Error>

    private(set) var blockedUsersRequestCount = 0
    private(set) var blockRequests: [String] = []
    private(set) var unblockRequests: [String] = []

    init(
        blockedUsersResult: Result<[BlockedUser], Error> = .success([]),
        blockResult: Result<BlockUserReceipt, Error> = .success(
            BlockUserReceipt(
                blockedUser: BlockedUser(
                    id: "user-2",
                    displayName: "Blocked Player",
                    blockedAt: "2026-07-23T12:00:00.000Z"
                ),
                alreadyBlocked: false
            )
        ),
        unblockResult: Result<UnblockUserReceipt, Error> = .success(
            UnblockUserReceipt(
                blockedUserId: "user-2",
                wasBlocked: true
            )
        )
    ) {
        self.blockedUsersResult = blockedUsersResult
        self.blockResult = blockResult
        self.unblockResult = unblockResult
    }

    func blockedUsers() async throws -> [BlockedUser] {
        blockedUsersRequestCount += 1
        return try blockedUsersResult.get()
    }

    func block(userId: String) async throws -> BlockUserReceipt {
        blockRequests.append(userId)
        return try blockResult.get()
    }

    func unblock(userId: String) async throws -> UnblockUserReceipt {
        unblockRequests.append(userId)
        return try unblockResult.get()
    }
}
