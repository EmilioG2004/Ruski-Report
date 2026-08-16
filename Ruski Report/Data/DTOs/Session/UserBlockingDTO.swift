//
//  UserBlockingDTO.swift
//  Ruski Report
//

import Foundation

nonisolated struct BlockedUserDTO: Decodable, Equatable {
    let userId: String
    let displayName: String
    let blockedAt: String
}

nonisolated struct BlockUserReceiptDTO: Decodable, Equatable {
    let blockedUser: BlockedUserDTO
    let alreadyBlocked: Bool
}

nonisolated struct UnblockUserReceiptDTO: Decodable, Equatable {
    let blockedUserId: String
    let wasBlocked: Bool
}
