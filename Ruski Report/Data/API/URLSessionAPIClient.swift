//
//  URLSessionAPIClient.swift
//  Ruski Report
//

import Foundation

nonisolated final class URLSessionAPIClient: APIClient {
    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    private let authorizer: any RequestAuthorizer

    init(
        baseURL: URL,
        session: URLSession = .shared,
        decoder: JSONDecoder = JSONDecoder(),
        encoder: JSONEncoder = JSONEncoder(),
        authorizer: any RequestAuthorizer = NoopRequestAuthorizer()
    ) {
        self.baseURL = baseURL
        self.session = session
        self.decoder = decoder
        self.encoder = encoder
        self.authorizer = authorizer
    }

    func get<Response: Decodable>(_ path: String) async throws -> Response {
        try decode(try await request(path: path, method: "GET", body: nil))
    }

    func post<Response: Decodable, Body: Encodable>(
        _ path: String,
        body: Body
    ) async throws -> Response {
        let encodedBody: Data

        do {
            encodedBody = try encoder.encode(body)
        } catch {
            throw AppError.encodingFailed(error.localizedDescription)
        }

        return try decode(
            try await request(path: path, method: "POST", body: encodedBody)
        )
    }

    func delete(_ path: String) async throws {
        _ = try await request(path: path, method: "DELETE", body: nil)
    }

    func put<Response: Decodable>(_ path: String) async throws -> Response {
        try decode(try await request(path: path, method: "PUT", body: nil))
    }

    func delete<Response: Decodable>(
        _ path: String,
        response: Response.Type
    ) async throws -> Response {
        try decode(try await request(path: path, method: "DELETE", body: nil))
    }

    private func request(
        path: String,
        method: String,
        body: Data?
    ) async throws -> Data {
        let url = try makeURL(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        try await authorizer.authorize(&request)

        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            throw AppError.networkUnavailable(error.localizedDescription)
        } catch {
            throw AppError.networkUnavailable(error.localizedDescription)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AppError.badResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            throw mapErrorResponse(data: data, statusCode: httpResponse.statusCode)
        }

        return data
    }

    private func decode<Response: Decodable>(_ data: Data) throws -> Response {
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw AppError.decodingFailed(error.localizedDescription)
        }
    }

    private func makeURL(path: String) throws -> URL {
        guard let relativeComponents = URLComponents(string: path),
              relativeComponents.scheme == nil,
              relativeComponents.host == nil,
              relativeComponents.fragment == nil else {
            throw AppError.invalidURL(path)
        }

        let trimmedPath = relativeComponents.path.trimmingCharacters(
            in: CharacterSet(charactersIn: "/")
        )
        var url = baseURL

        for component in trimmedPath.split(separator: "/") {
            url.appendPathComponent(String(component))
        }

        guard var components = URLComponents(
            url: url,
            resolvingAgainstBaseURL: false
        ),
        components.scheme != nil,
        components.host != nil else {
            throw AppError.invalidURL(path)
        }

        components.queryItems = relativeComponents.queryItems

        guard let resolvedURL = components.url else {
            throw AppError.invalidURL(path)
        }

        return resolvedURL
    }

    private func mapErrorResponse(data: Data, statusCode: Int) -> AppError {
        if let errorResponse = try? decoder.decode(APIErrorResponseDTO.self, from: data) {
            return APIErrorMapper.map(errorResponse)
        }

        return AppError.badStatus(code: statusCode, message: nil)
    }
}
