//
//  AppConfig.swift
//  Ruski Report
//

import Foundation

nonisolated struct AppConfig: Equatable {
    let apiBaseURL: URL

    static let fallback = AppConfig(
        apiBaseURL: URL(string: "http://localhost:3000/api")!
    )

    static func load(
        bundle: Bundle = .main,
        processInfo: ProcessInfo = .processInfo
    ) throws -> AppConfig {
        if let override = processInfo.environment["RUSKI_API_BASE_URL"],
           !override.isEmpty {
            return try AppConfig(apiBaseURLString: override)
        }

        guard let url = bundle.url(forResource: "AppConfig", withExtension: "json") else {
            throw AppConfigError.missingConfigFile
        }

        do {
            let data = try Data(contentsOf: url)
            let dto = try JSONDecoder().decode(AppConfigDTO.self, from: data)
            return try AppConfig(apiBaseURLString: dto.apiBaseURL)
        } catch let error as AppConfigError {
            throw error
        } catch {
            throw AppConfigError.invalidConfig(error.localizedDescription)
        }
    }

    private init(apiBaseURLString: String) throws {
        guard let url = URL(string: apiBaseURLString),
              url.scheme != nil,
              url.host != nil else {
            throw AppConfigError.invalidAPIBaseURL(apiBaseURLString)
        }

        self.apiBaseURL = url
    }

    private init(apiBaseURL: URL) {
        self.apiBaseURL = apiBaseURL
    }
}

private struct AppConfigDTO: Decodable {
    let apiBaseURL: String
}

nonisolated enum AppConfigError: Error, Equatable {
    case missingConfigFile
    case invalidAPIBaseURL(String)
    case invalidConfig(String)
}

extension AppConfigError: LocalizedError {
    var errorDescription: String? {
        switch self {
        case .missingConfigFile:
            "AppConfig.json is missing from the app bundle."
        case .invalidAPIBaseURL(let value):
            "AppConfig.json has an invalid API base URL: \(value)"
        case .invalidConfig(let message):
            "AppConfig.json could not be loaded: \(message)"
        }
    }
}
