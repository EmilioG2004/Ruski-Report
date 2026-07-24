//
//  PreviewUserBlockingRepository.swift
//  Ruski Report
//

import Foundation

actor PreviewUserBlockingState {
    private var users: [BlockedUser]

    init(
        blockedUsers: [BlockedUser] = [
            BlockedUser(
                id: "preview-blocked-user",
                displayName: "Blocked Player",
                blockedAt: "2026-07-23T12:00:00.000Z"
            )
        ]
    ) {
        users = blockedUsers
    }

    func blockedUsers() -> [BlockedUser] {
        users
    }

    func block(_ user: BlockedUser) -> Bool {
        guard !users.contains(where: { $0.id == user.id }) else {
            return false
        }
        users.append(user)
        return true
    }

    func unblock(userId: String) -> Bool {
        let count = users.count
        users.removeAll { $0.id == userId }
        return users.count != count
    }

    func blockedUserIds() -> Set<String> {
        Set(users.map(\.id))
    }
}

nonisolated final class PreviewUserBlockingRepository: UserBlockingRepository {
    private let state: PreviewUserBlockingState
    private let displayNames: [String: String]

    init(
        state: PreviewUserBlockingState = PreviewUserBlockingState(),
        displayNames: [String: String] = [
            "preview-commenter-alex": "Alex",
            "preview-user": "Emilio Garcia"
        ]
    ) {
        self.state = state
        self.displayNames = displayNames
    }

    func blockedUsers() async throws -> [BlockedUser] {
        await state.blockedUsers()
    }

    func block(userId: String) async throws -> BlockUserReceipt {
        let user = BlockedUser(
            id: userId,
            displayName: displayNames[userId] ?? "Commenter",
            blockedAt: "2026-07-23T12:00:00.000Z"
        )
        let created = await state.block(user)
        return BlockUserReceipt(
            blockedUser: user,
            alreadyBlocked: !created
        )
    }

    func unblock(userId: String) async throws -> UnblockUserReceipt {
        UnblockUserReceipt(
            blockedUserId: userId,
            wasBlocked: await state.unblock(userId: userId)
        )
    }
}
