//
//  RemoteUserBlockingRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class RemoteUserBlockingRepository: UserBlockingRepository {
    private let apiClient: APIClient
    private let session: any SessionRepository

    init(apiClient: APIClient, session: any SessionRepository) {
        self.apiClient = apiClient
        self.session = session
    }

    func blockedUsers() async throws -> [BlockedUser] {
        try await requireBlockingCapability()
        let dtos: [BlockedUserDTO] = try await apiClient.get("account/blocks")
        return dtos.map(UserBlockingMapper.map)
    }

    func block(userId: String) async throws -> BlockUserReceipt {
        try await requireBlockingCapability()
        let dto: BlockUserReceiptDTO = try await apiClient.put(
            "account/blocks/\(userId)"
        )
        return UserBlockingMapper.map(dto)
    }

    func unblock(userId: String) async throws -> UnblockUserReceipt {
        try await requireBlockingCapability()
        let dto: UnblockUserReceiptDTO = try await apiClient.delete(
            "account/blocks/\(userId)",
            response: UnblockUserReceiptDTO.self
        )
        return UserBlockingMapper.map(dto)
    }

    private func requireBlockingCapability() async throws {
        let currentSession = await session.currentSession()
        guard currentSession.canBlockUsers else {
            throw AppError.unsupported("Sign in to manage blocked users.")
        }
    }
}
