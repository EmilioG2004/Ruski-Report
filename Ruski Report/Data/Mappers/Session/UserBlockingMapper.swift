//
//  UserBlockingMapper.swift
//  Ruski Report
//

import Foundation

nonisolated enum UserBlockingMapper {
    static func map(_ dto: BlockedUserDTO) -> BlockedUser {
        BlockedUser(
            id: dto.userId,
            displayName: dto.displayName,
            blockedAt: dto.blockedAt
        )
    }

    static func map(_ dto: BlockUserReceiptDTO) -> BlockUserReceipt {
        BlockUserReceipt(
            blockedUser: map(dto.blockedUser),
            alreadyBlocked: dto.alreadyBlocked
        )
    }

    static func map(_ dto: UnblockUserReceiptDTO) -> UnblockUserReceipt {
        UnblockUserReceipt(
            blockedUserId: dto.blockedUserId,
            wasBlocked: dto.wasBlocked
        )
    }
}
