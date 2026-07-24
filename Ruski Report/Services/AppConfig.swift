//
//  AppConfig.swift
//  Ruski Report
//

import Foundation

nonisolated struct AppConfig: Equatable {
    let apiBaseURL: URL
    let policyLinks: AppPolicyLinks

    static let fallback = AppConfig(
        apiBaseURL: URL(string: "http://127.0.0.1:3000/api")!,
        policyLinks: .productionFallback
    )

    static func load(
        bundle: Bundle = .main,
        processInfo: ProcessInfo = .processInfo
    ) throws -> AppConfig {
        guard let url = bundle.url(forResource: "AppConfig", withExtension: "json") else {
            throw AppConfigError.missingConfigFile
        }

        do {
            let data = try Data(contentsOf: url)
            let dto = try JSONDecoder().decode(AppConfigDTO.self, from: data)
            let environment = processInfo.environment
            let policyLinks = try AppPolicyLinks(
                privacyPolicyURLString:
                    Self.configuredValue(
                        environment["RUSKI_PRIVACY_POLICY_URL"],
                        fallback: dto.policyLinks.privacyPolicy
                    ),
                supportURLString:
                    Self.configuredValue(
                        environment["RUSKI_SUPPORT_URL"],
                        fallback: dto.policyLinks.support
                    ),
                communityStandardsURLString:
                    Self.configuredValue(
                        environment["RUSKI_COMMUNITY_STANDARDS_URL"],
                        fallback: dto.policyLinks.communityStandards
                    )
            )

            return try AppConfig(
                apiBaseURLString:
                    Self.configuredValue(
                        environment["RUSKI_API_BASE_URL"],
                        fallback: dto.apiBaseURL
                    ),
                policyLinks: policyLinks
            )
        } catch let error as AppConfigError {
            throw error
        } catch {
            throw AppConfigError.invalidConfig(error.localizedDescription)
        }
    }

    init(
        apiBaseURLString: String,
        policyLinks: AppPolicyLinks
    ) throws {
        let normalizedValue = apiBaseURLString.trimmingCharacters(
            in: .whitespacesAndNewlines
        )

        guard let url = URL(string: normalizedValue),
              url.scheme != nil,
              url.host != nil else {
            throw AppConfigError.invalidAPIBaseURL(apiBaseURLString)
        }

        self.apiBaseURL = Self.normalizedLocalDevelopmentURL(url)
        self.policyLinks = policyLinks
    }

    private init(apiBaseURL: URL, policyLinks: AppPolicyLinks) {
        self.apiBaseURL = apiBaseURL
        self.policyLinks = policyLinks
    }

    private static func normalizedLocalDevelopmentURL(_ url: URL) -> URL {
        guard var components = URLComponents(
            url: url,
            resolvingAgainstBaseURL: false
        ),
              components.host == "localhost" else {
            return url
        }

        components.host = "127.0.0.1"
        return components.url ?? url
    }

    private static func configuredValue(
        _ override: String?,
        fallback: String
    ) -> String {
        guard let override,
              !override.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return fallback
        }

        return override
    }
}

nonisolated private struct AppConfigDTO: Decodable {
    let apiBaseURL: String
    let policyLinks: AppPolicyLinksDTO
}

nonisolated private struct AppPolicyLinksDTO: Decodable {
    let privacyPolicy: String
    let support: String
    let communityStandards: String
}

nonisolated enum AppConfigError: Error, Equatable {
    case missingConfigFile
    case invalidAPIBaseURL(String)
    case invalidPolicyURL(name: String, value: String)
    case invalidConfig(String)
}

extension AppConfigError: LocalizedError {
    var errorDescription: String? {
        switch self {
        case .missingConfigFile:
            "AppConfig.json is missing from the app bundle."
        case .invalidAPIBaseURL(let value):
            "App configuration has an invalid API base URL: \(value)"
        case .invalidPolicyURL(let name, let value):
            "App configuration has an invalid \(name) URL: \(value)"
        case .invalidConfig(let message):
            "AppConfig.json could not be loaded: \(message)"
        }
    }
}
