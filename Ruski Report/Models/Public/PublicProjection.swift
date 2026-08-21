//
//  PublicProjection.swift
//  Ruski Report
//

import Foundation

nonisolated struct PublicProjectionReference: Equatable, Hashable {
    let tournamentId: String
    let version: Int64
    let activatedAt: String
}

nonisolated enum PublicContractValidationError: Error, Equatable {
    case unsupportedContractVersion(Int)
    case invalidValue(field: String, value: String)
    case identifierMismatch(field: String, expected: String, actual: String)
    case projectionVersionMismatch(expected: Int64, actual: Int64)
    case duplicateIdentity(kind: String, id: String)
    case missingReference(kind: String, id: String)
    case incoherent(String)
}
