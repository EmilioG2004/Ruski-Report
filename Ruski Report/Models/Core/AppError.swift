//
//  AppError.swift
//  Ruski Report
//

import Foundation

nonisolated struct AppErrorDetail: Equatable {
    let code: String?
    let message: String
    let path: String?
}

nonisolated enum AppError: Error, Equatable {
    case invalidURL(String)
    case networkUnavailable(String)
    case badResponse
    case badStatus(code: Int, message: String?)
    case backend(code: String, message: String, details: [AppErrorDetail])
    case encodingFailed(String)
    case decodingFailed(String)
    case unsupported(String)
}

nonisolated extension AppError: LocalizedError {
    var errorDescription: String? {
        switch self {
        case .invalidURL(let path):
            "Invalid API URL for path: \(path)"
        case .networkUnavailable(let message):
            message
        case .badResponse:
            "The server returned an invalid response."
        case .badStatus(let code, let message):
            message ?? "The server returned status \(code)."
        case .backend(_, let message, _):
            message
        case .encodingFailed(let message):
            "Unable to encode the request body: \(message)"
        case .decodingFailed(let message):
            "Unable to decode the server response: \(message)"
        case .unsupported(let message):
            message
        }
    }
}
