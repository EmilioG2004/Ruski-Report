//
//  APIClientTests.swift
//  Ruski ReportTests
//

import Foundation
import Testing
@testable import Ruski_Report

struct APIClientTests {
    @Test func getDecodesSuccessfulJSONAndBuildsPath() async throws {
        let client = makeClient { request in
            MockURLProtocol.lastRequest = request
            return (
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: nil
                )!,
                Data(#"{"name":"Ruski"}"#.utf8)
            )
        }

        let response: TestResponseDTO = try await client.get("games")

        #expect(response.name == "Ruski")
        #expect(MockURLProtocol.lastRequest?.url?.absoluteString == "http://localhost:3000/api/games")
    }

    @Test func backendErrorResponseMapsToAppError() async throws {
        let client = makeClient { request in
            (
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 404,
                    httpVersion: nil,
                    headerFields: nil
                )!,
                Data(
                    """
                    {
                      "code": "NOT_FOUND",
                      "message": "Tournament not found.",
                      "details": [
                        {
                          "code": "RESOURCE_NOT_FOUND",
                          "message": "Tournament not found.",
                          "path": "tournament"
                        }
                      ]
                    }
                    """.utf8
                )
            )
        }

        do {
            let _: TestResponseDTO = try await client.get("tournaments/missing")
            Issue.record("Expected backend error response to throw.")
        } catch let error as AppError {
            #expect(
                error == .backend(
                    code: "NOT_FOUND",
                    message: "Tournament not found.",
                    details: [
                        AppErrorDetail(
                            code: "RESOURCE_NOT_FOUND",
                            message: "Tournament not found.",
                            path: "tournament"
                        )
                    ]
                )
            )
        }
    }

    @Test func decodingFailureMapsToAppError() async throws {
        let client = makeClient { request in
            (
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: nil
                )!,
                Data(#"{"unexpected":"shape"}"#.utf8)
            )
        }

        do {
            let _: TestResponseDTO = try await client.get("games")
            Issue.record("Expected malformed JSON to throw.")
        } catch let error as AppError {
            guard case .decodingFailed = error else {
                Issue.record("Expected decodingFailed, got \(error).")
                return
            }
        }
    }

    @Test func postEncodesJSONBody() async throws {
        let client = makeClient { request in
            MockURLProtocol.lastRequest = request
            MockURLProtocol.lastBody = request.httpBody

            return (
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: nil
                )!,
                Data(#"{"name":"posted"}"#.utf8)
            )
        }

        let response: TestResponseDTO = try await client.post(
            "matches/match-1/comments",
            body: TestRequestDTO(name: "hello")
        )

        #expect(response.name == "posted")
        #expect(MockURLProtocol.lastRequest?.httpMethod == "POST")
        #expect(MockURLProtocol.lastBody == Data(#"{"name":"hello"}"#.utf8))
    }

    private func makeClient(
        handler: @escaping MockURLProtocol.RequestHandler
    ) -> URLSessionAPIClient {
        MockURLProtocol.requestHandler = handler
        MockURLProtocol.lastRequest = nil
        MockURLProtocol.lastBody = nil

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)

        return URLSessionAPIClient(
            baseURL: URL(string: "http://localhost:3000/api")!,
            session: session
        )
    }
}
