//
//  AppBundleIdentity.swift
//  Ruski Report
//

import Foundation

nonisolated enum AppBundleIdentity {
    static var identifier: String {
        Bundle.main.bundleIdentifier ?? "Ruski Report"
    }

    static var logSubsystem: String {
        identifier
    }

    static var sessionCredentialService: String {
        "\(identifier).account-session"
    }
}
