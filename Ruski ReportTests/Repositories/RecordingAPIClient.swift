//
//  RecordingAPIClient.swift
//  Ruski ReportTests
//

@testable import Ruski_Report

final class RecordingAPIClient: APIClient {
    var requestedPaths: [String] = []
    var responses: [String: Any] = [:]
    var postedBodies: [String: Any] = [:]

    func get<Response: Decodable>(_ path: String) async throws -> Response {
        requestedPaths.append(path)

        guard let response = responses[path] as? Response else {
            throw AppError.unsupported("Missing response for \(path).")
        }

        return response
    }

    func post<Response: Decodable, Body: Encodable>(
        _ path: String,
        body: Body
    ) async throws -> Response {
        requestedPaths.append(path)
        postedBodies[path] = body

        guard let response = responses[path] as? Response else {
            throw AppError.unsupported("Missing response for \(path).")
        }

        return response
    }

    func delete(_ path: String) async throws {
        requestedPaths.append(path)
    }
}
