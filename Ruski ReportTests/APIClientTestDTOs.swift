//
//  APIClientTestDTOs.swift
//  Ruski ReportTests
//

struct TestResponseDTO: Decodable, Equatable {
    let name: String
}

struct TestRequestDTO: Encodable, Equatable {
    let name: String
}
