//
//  UserBlockingModels.swift
//  Ruski Report
//

import Foundation

nonisolated struct BlockedUser: Identifiable, Equatable {
    let id: String
    let displayName: String
    let blockedAt: String
}

nonisolated struct BlockUserReceipt: Equatable {
    let blockedUser: BlockedUser
    let alreadyBlocked: Bool
}

nonisolated struct UnblockUserReceipt: Equatable {
    let blockedUserId: String
    let wasBlocked: Bool
}

nonisolated struct BlockUserPresentation: Identifiable, Equatable {
    let id: String
    let displayName: String
}
