//
//  PublicStatisticMapper.swift
//  Ruski Report
//

import Foundation

nonisolated enum PublicStatisticMapper {
    static func statistic(
        _ dto: PublicStatisticDTO,
        knownTeams: [String: String]? = nil,
        knownPlayers: [String: String]? = nil
    ) throws -> PublicStatistic {
        guard let scope = PublicStatisticScope(rawValue: dto.scope) else {
            throw PublicContractValidationError.invalidValue(
                field: "statistic.scope",
                value: dto.scope
            )
        }
        try PublicContractMapper.requireIdentity(
            dto.scopeId,
            field: "statistic.scopeId"
        )

        let stage: PublicMatchStage?
        if let value = dto.stage {
            guard let mapped = PublicMatchStage(rawValue: value) else {
                throw PublicContractValidationError.invalidValue(
                    field: "statistic.stage",
                    value: value
                )
            }
            stage = mapped
        } else {
            stage = nil
        }

        let subject = try dto.subject.map {
            try mapSubject($0, knownTeams: knownTeams, knownPlayers: knownPlayers)
        }

        return PublicStatistic(
            scope: scope,
            scopeId: dto.scopeId,
            stage: stage,
            subject: subject,
            values: dto.values
        )
    }

    private static func mapSubject(
        _ dto: PublicStatisticSubjectDTO,
        knownTeams: [String: String]?,
        knownPlayers: [String: String]?
    ) throws -> PublicStatisticSubject {
        try PublicContractMapper.requireIdentity(dto.id, field: "statistic.subject.id")

        switch (dto.name, dto.displayName) {
        case (.some(let name), .none):
            let team = try PublicContractMapper.requireTeamIdentity(
                PublicTeamIdentityDTO(id: dto.id, name: name),
                knownTeams: knownTeams
            )
            return .team(team)
        case (.none, .some(let displayName)):
            try PublicContractMapper.requireIdentity(
                displayName,
                field: "statistic.subject.displayName"
            )
            if let knownPlayers {
                guard let expected = knownPlayers[dto.id] else {
                    throw PublicContractValidationError.missingReference(
                        kind: "player",
                        id: dto.id
                    )
                }
                guard expected == displayName else {
                    throw PublicContractValidationError.identifierMismatch(
                        field: "player.displayName",
                        expected: expected,
                        actual: displayName
                    )
                }
            }
            return .player(id: dto.id, displayName: displayName)
        default:
            throw PublicContractValidationError.incoherent(
                "Statistic subjects must contain exactly one display identity."
            )
        }
    }
}
