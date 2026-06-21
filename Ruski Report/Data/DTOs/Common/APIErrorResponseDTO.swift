//
//  APIErrorResponseDTO.swift
//  Ruski Report
//

import Foundation

nonisolated struct APIErrorResponseDTO: Decodable, Equatable {
    let code: String
    let message: String
    let details: [APIErrorDetailDTO]
}

nonisolated struct APIErrorDetailDTO: Decodable, Equatable {
    let code: String?
    let message: String
    let path: String?
}
