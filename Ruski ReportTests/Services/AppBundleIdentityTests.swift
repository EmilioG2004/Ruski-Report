//
//  AppBundleIdentityTests.swift
//  Ruski ReportTests
//

import Testing
@testable import Ruski_Report

struct AppBundleIdentityTests {
    @Test
    func sessionCredentialServiceUsesTheInstalledBundleIdentifier() {
        #expect(
            AppBundleIdentity.sessionCredentialService ==
                "\(AppBundleIdentity.identifier).account-session"
        )
    }
}
