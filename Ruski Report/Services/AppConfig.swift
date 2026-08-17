//
//  AppConfig.swift
//  Ruski Report
//

import Foundation

nonisolated struct AppConfig: Equatable {
    let apiBaseURL: URL
    let policyLinks: AppPolicyLinks

#if DEBUG
    static let fallback = AppConfig(
        apiBaseURL: URL(string: "http://127.0.0.1:3000/api")!,
        policyLinks: .productionFallback
    )
#else
    static let fallback = AppConfig(
        apiBaseURL: URL(string: "https://api.ruskireport.com/api")!,
        policyLinks: .productionFallback
    )
#endif

    private static let apiBaseURLInfoKey = "RUSKI_API_BASE_URL"
    private static let buildConfigurationInfoKey = "RUSKI_BUILD_CONFIGURATION"

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
            let buildConfiguration = try Self.buildConfiguration(from: bundle)
            let bundledAPIBaseURL = try Self.bundledAPIBaseURL(from: bundle)
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
                apiBaseURLString: Self.resolvedAPIBaseURLString(
                    bundledValue: bundledAPIBaseURL,
                    buildConfiguration: buildConfiguration,
                    environment: environment
                ),
                buildConfiguration: buildConfiguration,
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
        buildConfiguration: AppBuildConfiguration,
        policyLinks: AppPolicyLinks
    ) throws {
        let normalizedValue = apiBaseURLString.trimmingCharacters(
            in: .whitespacesAndNewlines
        )

        guard let components = URLComponents(string: normalizedValue),
              let scheme = components.scheme?.lowercased(),
              let host = components.host?.lowercased(),
              !host.isEmpty,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              let url = components.url else {
            throw AppConfigError.invalidAPIBaseURL(apiBaseURLString)
        }

#if DEBUG
        let isLoopback = Self.localDevelopmentHosts.contains(host)
        let isValidTransport = switch buildConfiguration {
        case .debug:
            scheme == "https" || (scheme == "http" && isLoopback)
        case .release:
            scheme == "https"
        }
#else
        let isValidTransport = scheme == "https"
#endif

        guard isValidTransport else {
            throw AppConfigError.insecureAPIBaseURL(
                configuration: buildConfiguration,
                value: apiBaseURLString
            )
        }

#if DEBUG
        self.apiBaseURL = Self.normalizedLocalDevelopmentURL(url)
#else
        self.apiBaseURL = url
#endif
        self.policyLinks = policyLinks
    }

    private init(apiBaseURL: URL, policyLinks: AppPolicyLinks) {
        self.apiBaseURL = apiBaseURL
        self.policyLinks = policyLinks
    }

#if DEBUG
    private static let localDevelopmentHosts = ["localhost", "127.0.0.1", "::1"]

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
#endif

    static func resolvedAPIBaseURLString(
        bundledValue: String,
        buildConfiguration: AppBuildConfiguration,
        environment: [String: String]
    ) -> String {
        guard buildConfiguration == .debug else {
            return bundledValue
        }

        return configuredValue(
            environment["RUSKI_API_BASE_URL"],
            fallback: bundledValue
        )
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

    private static func buildConfiguration(
        from bundle: Bundle
    ) throws -> AppBuildConfiguration {
        guard let value = bundle.object(
            forInfoDictionaryKey: buildConfigurationInfoKey
        ) as? String,
              let configuration = AppBuildConfiguration(rawValue: value) else {
            throw AppConfigError.missingBuildConfiguration
        }

        return configuration
    }

    private static func bundledAPIBaseURL(from bundle: Bundle) throws -> String {
        guard let value = bundle.object(
            forInfoDictionaryKey: apiBaseURLInfoKey
        ) as? String,
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw AppConfigError.missingAPIBaseURL
        }

        return value
    }
}

nonisolated private struct AppConfigDTO: Decodable {
    let policyLinks: AppPolicyLinksDTO
}

nonisolated private struct AppPolicyLinksDTO: Decodable {
    let privacyPolicy: String
    let support: String
    let communityStandards: String
}

nonisolated enum AppConfigError: Error, Equatable {
    case missingConfigFile
    case missingBuildConfiguration
    case missingAPIBaseURL
    case invalidAPIBaseURL(String)
    case insecureAPIBaseURL(
        configuration: AppBuildConfiguration,
        value: String
    )
    case invalidPolicyURL(name: String, value: String)
    case invalidConfig(String)
}

nonisolated enum AppBuildConfiguration: String, Equatable {
    case debug = "Debug"
    case release = "Release"
}

extension AppConfigError: LocalizedError {
    var errorDescription: String? {
        switch self {
        case .missingConfigFile:
            "AppConfig.json is missing from the app bundle."
        case .missingBuildConfiguration:
            "The app bundle is missing its build configuration."
        case .missingAPIBaseURL:
            "The app bundle is missing its API base URL."
        case .invalidAPIBaseURL(let value):
            "App configuration has an invalid API base URL: \(value)"
        case .insecureAPIBaseURL(let configuration, let value):
            "App configuration has an insecure API base URL for \(configuration.rawValue): \(value)"
        case .invalidPolicyURL(let name, let value):
            "App configuration has an invalid \(name) URL: \(value)"
        case .invalidConfig(let message):
            "AppConfig.json could not be loaded: \(message)"
        }
    }
}
