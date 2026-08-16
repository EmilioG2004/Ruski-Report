//
//  AppConfigTests.swift
//  Ruski ReportTests
//

import Foundation
import Testing
@testable import Ruski_Report

struct AppConfigTests {
    @Test func policyLinksRequireHTTPSDestinations() throws {
        #expect(throws: AppConfigError.self) {
            try AppPolicyLinks(
                privacyPolicyURLString: "http://example.com/privacy",
                supportURLString: "https://example.com/support",
                communityStandardsURLString: "https://example.com/community"
            )
        }
    }

    @Test func policyLinksRejectEmbeddedCredentials() throws {
        #expect(throws: AppConfigError.self) {
            try AppPolicyLinks(
                privacyPolicyURLString: "https://user:secret@example.com/privacy",
                supportURLString: "https://example.com/support",
                communityStandardsURLString: "https://example.com/community"
            )
        }
    }

    @Test func appConfigNormalizesLocalhostForSimulatorAccess() throws {
        let config = try AppConfig(
            apiBaseURLString: "http://localhost:3000/api",
            policyLinks: .productionFallback
        )

        #expect(config.apiBaseURL.absoluteString == "http://127.0.0.1:3000/api")
    }

    @Test func bundledConfigProvidesProductionPolicyLinks() throws {
        let config = try AppConfig.load()

        #expect(config.policyLinks.privacyPolicy.scheme == "https")
        #expect(config.policyLinks.support.host == "emiliog2004.github.io")
        #expect(
            config.policyLinks.communityStandards.absoluteString
                .hasSuffix("/community-standards/")
        )
    }
}
