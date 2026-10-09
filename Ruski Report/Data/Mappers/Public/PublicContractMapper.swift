//
//  PublicContractMapper.swift
//  Ruski Report
//

import Foundation

nonisolated enum PublicContractMapper {
    static let contractVersion = 2

    static func validateContractVersion(_ actual: Int) throws {
        guard actual == contractVersion else {
            throw PublicContractValidationError.unsupportedContractVersion(actual)
        }
    }

    static func projection(
        _ dto: PublicProjectionDTO,
        expectedTournamentId: String? = nil,
        expectedVersion: Int64? = nil
    ) throws -> PublicProjectionReference {
        try requireIdentity(dto.tournamentId, field: "projection.tournamentId")
        guard dto.version >= 1, dto.version <= 9_007_199_254_740_991 else {
            throw PublicContractValidationError.invalidValue(
                field: "projection.version",
                value: String(dto.version)
            )
        }
        try requireTimestamp(dto.activatedAt, field: "projection.activatedAt")
        guard dto.source == "canonical" else {
            throw PublicContractValidationError.invalidValue(
                field: "projection.source",
                value: dto.source
            )
        }

        if let expectedTournamentId, dto.tournamentId != expectedTournamentId {
            throw PublicContractValidationError.identifierMismatch(
                field: "projection.tournamentId",
                expected: expectedTournamentId,
                actual: dto.tournamentId
            )
        }
        if let expectedVersion, dto.version != expectedVersion {
            throw PublicContractValidationError.projectionVersionMismatch(
                expected: expectedVersion,
                actual: dto.version
            )
        }

        return PublicProjectionReference(
            tournamentId: dto.tournamentId,
            version: dto.version,
            activatedAt: dto.activatedAt
        )
    }

    static func requireIdentity(_ value: String, field: String) throws {
        guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw PublicContractValidationError.invalidValue(field: field, value: value)
        }
    }

    static func requirePositive(_ value: Int, field: String) throws {
        guard value > 0 else {
            throw PublicContractValidationError.invalidValue(
                field: field,
                value: String(value)
            )
        }
    }

    static func requireNonnegative(_ value: Int, field: String) throws {
        guard value >= 0 else {
            throw PublicContractValidationError.invalidValue(
                field: field,
                value: String(value)
            )
        }
    }

    static func requireTimestamp(_ value: String, field: String) throws {
        let standard = ISO8601DateFormatter()
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions.insert(.withFractionalSeconds)
        guard standard.date(from: value) != nil || fractional.date(from: value) != nil else {
            throw PublicContractValidationError.invalidValue(field: field, value: value)
        }
    }

    static func requireUnique(
        _ identities: [String],
        kind: String
    ) throws {
        var seen = Set<String>()
        for identity in identities {
            try requireIdentity(identity, field: "\(kind).id")
            guard seen.insert(identity).inserted else {
                throw PublicContractValidationError.duplicateIdentity(
                    kind: kind,
                    id: identity
                )
            }
        }
    }

    static func requireReference(
        _ identity: String,
        in identities: Set<String>,
        kind: String
    ) throws {
        guard identities.contains(identity) else {
            throw PublicContractValidationError.missingReference(
                kind: kind,
                id: identity
            )
        }
    }

    static func requireTeamIdentity(
        _ dto: PublicTeamIdentityDTO,
        knownTeams: [String: String]?
    ) throws -> PublicTeamIdentity {
        try requireIdentity(dto.id, field: "team.id")
        try requireIdentity(dto.name, field: "team.name")

        if let expectedName = knownTeams?[dto.id], expectedName != dto.name {
            throw PublicContractValidationError.identifierMismatch(
                field: "team.name",
                expected: expectedName,
                actual: dto.name
            )
        }
        if knownTeams != nil, knownTeams?[dto.id] == nil {
            throw PublicContractValidationError.missingReference(
                kind: "team",
                id: dto.id
            )
        }

        return PublicTeamIdentity(id: dto.id, name: dto.name)
    }

    static func player(_ dto: PublicPlayerDTO) throws -> PublicPlayer {
        try requireIdentity(dto.id, field: "player.id")
        try requireIdentity(dto.displayName, field: "player.displayName")
        try requirePositive(dto.rosterSlot, field: "player.rosterSlot")
        return PublicPlayer(
            id: dto.id,
            displayName: dto.displayName,
            rosterSlot: dto.rosterSlot
        )
    }
}
