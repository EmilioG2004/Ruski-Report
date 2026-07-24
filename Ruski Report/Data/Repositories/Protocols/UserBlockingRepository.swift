//
//  UserBlockingRepository.swift
//  Ruski Report
//

import Foundation

nonisolated protocol UserBlockingRepository {
    func blockedUsers() async throws -> [BlockedUser]
    func block(userId: String) async throws -> BlockUserReceipt
    func unblock(userId: String) async throws -> UnblockUserReceipt
}
