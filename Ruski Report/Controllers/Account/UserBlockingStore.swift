//
//  UserBlockingStore.swift
//  Ruski Report
//

import Combine
import Foundation

@MainActor
final class UserBlockingStore: ObservableObject {
    @Published private(set) var blockedUsers: [BlockedUser] = []
    @Published private(set) var loadState: BlockedUsersLoadState = .idle
    @Published private(set) var mutatingUserIds: Set<String> = []
    @Published private(set) var noticeMessage: String?
    @Published private(set) var actionErrorMessage: String?
    @Published private(set) var revision = 0

    private let blocking: any UserBlockingRepository
    private let session: any SessionRepository
    private let logger: any AppLogger
    private var loadedProfileId: String?

    init(
        blocking: any UserBlockingRepository,
        session: any SessionRepository,
        logger: any AppLogger
    ) {
        self.blocking = blocking
        self.session = session
        self.logger = logger
    }

    func synchronizeWithCurrentSession() async {
        let currentSession = await session.currentSession()
        guard let profile = currentSession.profile,
              currentSession.canBlockUsers else {
            reset()
            return
        }

        if loadedProfileId != profile.id {
            blockedUsers = []
            loadedProfileId = profile.id
        }
        await loadBlockedUsers()
    }

    func loadBlockedUsers() async {
        let currentSession = await session.currentSession()
        guard currentSession.canBlockUsers,
              let profile = currentSession.profile else {
            reset()
            return
        }

        loadedProfileId = profile.id
        loadState = .loading
        do {
            blockedUsers = try await blocking.blockedUsers()
            loadState = .loaded
            actionErrorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            logger.log(
                .warning,
                "Unable to load blocked users",
                metadata: ["error": String(describing: error)]
            )
            loadState = .failed(
                message: UserBlockingErrorFormatter.message(from: error)
            )
        }
    }

    func block(_ user: BlockUserPresentation) async -> UserBlockingOutcome {
        let currentSession = await session.currentSession()
        guard currentSession.canBlockUsers,
              let profile = currentSession.profile else {
            actionErrorMessage = "Sign in to block users."
            return .requiresSignIn
        }
        guard profile.id != user.id else {
            actionErrorMessage = "You cannot block your own account."
            return .failed
        }

        beginMutation(user.id)
        defer { endMutation(user.id) }

        do {
            let receipt = try await blocking.block(userId: user.id)
            upsert(receipt.blockedUser)
            revision += 1
            actionErrorMessage = nil
            noticeMessage = receipt.alreadyBlocked
                ? "\(receipt.blockedUser.displayName) was already blocked."
                : "\(receipt.blockedUser.displayName) is now blocked."
            return .blocked
        } catch is CancellationError {
            return .failed
        } catch {
            logger.log(
                .warning,
                "Unable to block user",
                metadata: ["error": String(describing: error)]
            )
            actionErrorMessage = UserBlockingErrorFormatter.message(from: error)
            return UserBlockingErrorFormatter.isAccountUnavailable(error)
                ? .accountUnavailable
                : .failed
        }
    }

    @discardableResult
    func unblock(_ user: BlockedUser) async -> Bool {
        beginMutation(user.id)
        defer { endMutation(user.id) }

        do {
            _ = try await blocking.unblock(userId: user.id)
            blockedUsers.removeAll { $0.id == user.id }
            loadState = .loaded
            revision += 1
            actionErrorMessage = nil
            noticeMessage = "\(user.displayName) was unblocked."
            return true
        } catch is CancellationError {
            return false
        } catch {
            logger.log(
                .warning,
                "Unable to unblock user",
                metadata: ["error": String(describing: error)]
            )
            actionErrorMessage = UserBlockingErrorFormatter.message(from: error)
            return false
        }
    }

    func isMutating(userId: String) -> Bool {
        mutatingUserIds.contains(userId)
    }

    func clearMessages() {
        noticeMessage = nil
        actionErrorMessage = nil
    }

    private func upsert(_ user: BlockedUser) {
        blockedUsers.removeAll { $0.id == user.id }
        blockedUsers.append(user)
        blockedUsers.sort {
            $0.blockedAt > $1.blockedAt ||
                ($0.blockedAt == $1.blockedAt && $0.id < $1.id)
        }
        loadState = .loaded
    }

    private func beginMutation(_ userId: String) {
        mutatingUserIds.insert(userId)
        actionErrorMessage = nil
        noticeMessage = nil
    }

    private func endMutation(_ userId: String) {
        mutatingUserIds.remove(userId)
    }

    private func reset() {
        blockedUsers = []
        loadState = .idle
        mutatingUserIds = []
        noticeMessage = nil
        actionErrorMessage = nil
        loadedProfileId = nil
        revision += 1
    }
}

nonisolated enum BlockedUsersLoadState: Equatable {
    case idle
    case loading
    case loaded
    case failed(message: String)
}

nonisolated enum UserBlockingOutcome: Equatable {
    case blocked
    case accountUnavailable
    case requiresSignIn
    case failed
}
