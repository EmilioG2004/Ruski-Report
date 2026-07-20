//
//  KeychainSessionCredentialStore.swift
//  Ruski Report
//

import Foundation
import Security

actor KeychainSessionCredentialStore: SessionCredentialStore {
    private let service: String
    private let account: String

    init(
        service: String = "Durham-Ruski-Club.Ruski-Report.account-session",
        account: String = "access-token"
    ) {
        self.service = service
        self.account = account
    }

    func accessToken() throws -> String? {
        var result: CFTypeRef?
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw keychainError(operation: "read", status: status)
        }
        guard let data = result as? Data,
              let token = String(data: data, encoding: .utf8) else {
            throw AppError.secureStorage("Stored session credentials are invalid.")
        }

        return token
    }

    func saveAccessToken(_ token: String) throws {
        let data = Data(token.utf8)
        let updateStatus = SecItemUpdate(
            baseQuery as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )

        if updateStatus == errSecSuccess {
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw keychainError(operation: "update", status: updateStatus)
        }

        var attributes = baseQuery
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] =
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(attributes as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw keychainError(operation: "save", status: addStatus)
        }
    }

    func clearAccessToken() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw keychainError(operation: "delete", status: status)
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    private func keychainError(operation: String, status: OSStatus) -> AppError {
        let detail = SecCopyErrorMessageString(status, nil) as String? ?? "OSStatus \(status)"
        return .secureStorage("Unable to \(operation) session credentials: \(detail)")
    }
}
