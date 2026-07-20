//
//  APIClient.swift
//  Ruski Report
//

import Foundation

nonisolated protocol APIClient {
    func get<Response: Decodable>(_ path: String) async throws -> Response

    func post<Response: Decodable, Body: Encodable>(
        _ path: String,
        body: Body
    ) async throws -> Response

    func delete(_ path: String) async throws
}
