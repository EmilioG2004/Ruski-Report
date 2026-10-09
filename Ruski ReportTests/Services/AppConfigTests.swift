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
            buildConfiguration: .debug,
            policyLinks: .productionFallback
        )

        #expect(config.apiBaseURL.absoluteString == "http://127.0.0.1:3000/api")
    }

    @Test func debugConfigRejectsInsecureNonLoopbackEndpoints() {
        #expect(throws: AppConfigError.self) {
            try AppConfig(
                apiBaseURLString: "http://192.168.8.129:3000/api",
                buildConfiguration: .debug,
                policyLinks: .productionFallback
            )
        }
    }

    @Test func releaseConfigUsesProductionHTTPSAPI() throws {
        let config = try AppConfig(
            apiBaseURLString: "https://api.ruskireport.com/api",
            buildConfiguration: .release,
            policyLinks: .productionFallback
        )

        #expect(config.apiBaseURL.absoluteString == "https://api.ruskireport.com/api")
    }

    @Test func releaseConfigRejectsHTTP() {
        #expect(throws: AppConfigError.self) {
            try AppConfig(
                apiBaseURLString: "http://api.ruskireport.com/api",
                buildConfiguration: .release,
                policyLinks: .productionFallback
            )
        }
    }

    @Test func appConfigRejectsEmbeddedCredentials() {
        #expect(throws: AppConfigError.self) {
            try AppConfig(
                apiBaseURLString: "https://admin:secret@api.ruskireport.com/api",
                buildConfiguration: .release,
                policyLinks: .productionFallback
            )
        }
    }

    @Test func appConfigRejectsMalformedURL() {
        #expect(throws: AppConfigError.self) {
            try AppConfig(
                apiBaseURLString: "not a URL",
                buildConfiguration: .release,
                policyLinks: .productionFallback
            )
        }
    }

    @Test func debugConfigUsesExplicitEnvironmentOverride() {
        let value = AppConfig.resolvedAPIBaseURLString(
            bundledValue: "http://127.0.0.1:3000/api",
            buildConfiguration: .debug,
            environment: ["RUSKI_API_BASE_URL": "https://debug.example.com/api"]
        )

        #expect(value == "https://debug.example.com/api")
    }

    @Test func releaseConfigIgnoresProcessEnvironmentOverride() {
        let value = AppConfig.resolvedAPIBaseURLString(
            bundledValue: "https://api.ruskireport.com/api",
            buildConfiguration: .release,
            environment: ["RUSKI_API_BASE_URL": "http://127.0.0.1:3000/api"]
        )

        #expect(value == "https://api.ruskireport.com/api")
    }

    @Test func bundledConfigProvidesDebugAPIAndProductionPolicyLinks() throws {
        let config = try AppConfig.load()

        #expect(config.apiBaseURL.absoluteString == "http://127.0.0.1:3000/api")
        #expect(config.policyLinks.privacyPolicy.scheme == "https")
        #expect(config.policyLinks.support.host == "emiliog2004.github.io")
        #expect(
            config.policyLinks.communityStandards.absoluteString
                .hasSuffix("/community-standards/")
        )
    }
}
