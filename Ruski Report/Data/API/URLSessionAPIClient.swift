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

    init(
        baseURL: URL,
        session: URLSession = .shared,
        decoder: JSONDecoder = JSONDecoder(),
        encoder: JSONEncoder = JSONEncoder()
    ) {
        self.baseURL = baseURL
        self.session = session
        self.decoder = decoder
        self.encoder = encoder
    }

    func get<Response: Decodable>(_ path: String) async throws -> Response {
        try await request(path: path, method: "GET", body: Optional<Data>.none)
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

        return try await request(path: path, method: "POST", body: encodedBody)
    }

    private func request<Response: Decodable>(
        path: String,
        method: String,
        body: Data?
    ) async throws -> Response {
        let url = try makeURL(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")

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

        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw AppError.decodingFailed(error.localizedDescription)
        }
    }

    private func makeURL(path: String) throws -> URL {
        let trimmedPath = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        var url = baseURL

        for component in trimmedPath.split(separator: "/") {
            url.appendPathComponent(String(component))
        }

        guard url.scheme != nil, url.host != nil else {
            throw AppError.invalidURL(path)
        }

        return url
    }

    private func mapErrorResponse(data: Data, statusCode: Int) -> AppError {
        if let errorResponse = try? decoder.decode(APIErrorResponseDTO.self, from: data) {
            return APIErrorMapper.map(errorResponse)
        }

        return AppError.badStatus(code: statusCode, message: nil)
    }
}
