//
//  AppPolicyLinks.swift
//  Ruski Report
//

import Foundation

nonisolated struct AppPolicyLinks: Equatable, Sendable {
    let privacyPolicy: URL
    let support: URL
    let communityStandards: URL

    init(
        privacyPolicyURLString: String,
        supportURLString: String,
        communityStandardsURLString: String
    ) throws {
        privacyPolicy = try Self.validatedHTTPSURL(
            privacyPolicyURLString,
            name: "privacy policy"
        )
        support = try Self.validatedHTTPSURL(
            supportURLString,
            name: "support"
        )
        communityStandards = try Self.validatedHTTPSURL(
            communityStandardsURLString,
            name: "community standards"
        )
    }

    private init(
        privacyPolicy: URL,
        support: URL,
        communityStandards: URL
    ) {
        self.privacyPolicy = privacyPolicy
        self.support = support
        self.communityStandards = communityStandards
    }

    private static func validatedHTTPSURL(
        _ value: String,
        name: String
    ) throws -> URL {
        let normalizedValue = value.trimmingCharacters(
            in: .whitespacesAndNewlines
        )

        guard let components = URLComponents(string: normalizedValue),
              components.scheme?.lowercased() == "https",
              components.host?.isEmpty == false,
              components.user == nil,
              components.password == nil,
              let url = components.url else {
            throw AppConfigError.invalidPolicyURL(name: name, value: value)
        }

        return url
    }

    static let productionFallback = AppPolicyLinks(
        privacyPolicy: URL(
            string: "https://emiliog2004.github.io/Ruski-Report/privacy/"
        )!,
        support: URL(
            string: "https://emiliog2004.github.io/Ruski-Report/support/"
        )!,
        communityStandards: URL(
            string: "https://emiliog2004.github.io/Ruski-Report/community-standards/"
        )!
    )
}
